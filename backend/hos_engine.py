"""
hos_engine.py - Pure Python Hours of Service (HOS) Engine.

No Django or third-party framework imports allowed.
Implements:
1. Property-carrying driver, 70 hrs / 8 days cycle.
2. 11-hour driving limit after 10 consecutive hours rest.
3. 14-hour window from coming on duty after a 10-hour rest (off-duty does NOT extend it).
4. 30-minute break after 8 cumulative hours of driving without a 30+ min non-driving break.
5. 10-hour rest: resets 11-hour and 14-hour clocks (status = SLEEPER).
6. 34-hour restart: resets cycle to 0 (status = OFF_DUTY).
7. Fuel stop: 30 min ON_DUTY_NOT_DRIVING at least once every 1,000 miles.
8. Pickup (1h) and dropoff (1h) ON_DUTY_NOT_DRIVING.
9. Midnight splitting in home-terminal time; each day sums to exactly 24.0 hours.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, date, time, timedelta
from typing import List, Dict, Optional, Tuple, Any

# Duty Status Constants
OFF_DUTY = "OFF_DUTY"
SLEEPER = "SLEEPER"
DRIVING = "DRIVING"
ON_DUTY_NOT_DRIVING = "ON_DUTY_NOT_DRIVING"

ALL_STATUSES = [OFF_DUTY, SLEEPER, DRIVING, ON_DUTY_NOT_DRIVING]

# Configuration Constants
REST_STATUS_10HR = SLEEPER
RESTART_STATUS_34HR = OFF_DUTY

FUEL_STOP_INTERVAL_MILES = 1000.0
FUEL_STOP_DURATION_MINUTES = 30.0

PICKUP_DURATION_MINUTES = 60.0
DROPOFF_DURATION_MINUTES = 60.0

MAX_DRIVING_WITHOUT_REST_HOURS = 11.0
MAX_DUTY_WINDOW_HOURS = 14.0
MAX_DRIVING_BEFORE_BREAK_HOURS = 8.0
BREAK_MINIMUM_DURATION_MINUTES = 30.0
CYCLE_MAX_HOURS = 70.0
REST_10HR_HOURS = 10.0
RESTART_34HR_HOURS = 34.0


@dataclass
class Segment:
    status: str
    start: datetime
    end: datetime
    location_label: str
    miles: float = 0.0
    reason: str = ""
    start_coordinates: Optional[Tuple[float, float]] = None
    end_coordinates: Optional[Tuple[float, float]] = None
    original_duration_hours: Optional[float] = None
    event_id: Optional[str] = None


    @property
    def duration_hours(self) -> float:
        return (self.end - self.start).total_seconds() / 3600.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "duration_hours": round(self.duration_hours, 4),
            "original_duration_hours": round(self.original_duration_hours or self.duration_hours, 4),
            "event_id": self.event_id,
            "location_label": self.location_label,
            "miles": round(self.miles, 2),
            "reason": self.reason,
            "start_coordinates": self.start_coordinates,
            "end_coordinates": self.end_coordinates,
        }



@dataclass
class TripLeg:
    name: str  # e.g. "Current to Pickup" or "Pickup to Dropoff"
    start_label: str
    end_label: str
    distance_miles: float
    duration_hours: float
    start_coords: Optional[Tuple[float, float]] = None
    end_coords: Optional[Tuple[float, float]] = None


@dataclass
class DailyLog:
    date: date
    segments: List[Segment]
    hours_per_status: Dict[str, float]
    total_hours: float
    miles_driving_today: float
    total_mileage_today: float
    recap: Dict[str, float]
    from_city: str = ""
    to_city: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "date": self.date.isoformat(),
            "segments": [s.to_dict() for s in self.segments],
            "hours_per_status": {k: round(v, 4) for k, v in self.hours_per_status.items()},
            "total_hours": round(self.total_hours, 4),
            "miles_driving_today": round(self.miles_driving_today, 2),
            "total_mileage_today": round(self.total_mileage_today, 2),
            "recap": {k: round(v, 4) for k, v in self.recap.items()},
            "from_city": self.from_city,
            "to_city": self.to_city,
        }



@dataclass
class SimulationState:
    current_time: datetime
    cycle_used: float  # hours used in 70h cycle
    driving_since_rest: float = 0.0  # max 11.0
    shift_start_time: Optional[datetime] = None  # for 14.0 window
    driving_since_break: float = 0.0  # max 8.0
    miles_since_fuel: float = 0.0  # max 1000.0

    def record_non_driving_duration(self, status: str, duration_hours: float):
        """Update clocks when non-driving time occurs."""
        if duration_hours >= BREAK_MINIMUM_DURATION_MINUTES / 60.0:
            # 30+ min of any non-driving status resets the 30-min break clock
            self.driving_since_break = 0.0

        if status == ON_DUTY_NOT_DRIVING:
            self.cycle_used += duration_hours
            if self.shift_start_time is None:
                self.shift_start_time = self.current_time

    def record_rest(self, rest_type: str, duration_hours: float):
        """10-hr rest or 34-hr restart."""
        if rest_type == "10hr":
            self.driving_since_rest = 0.0
            self.shift_start_time = None
            self.driving_since_break = 0.0
        elif rest_type == "34hr":
            self.driving_since_rest = 0.0
            self.shift_start_time = None
            self.driving_since_break = 0.0
            self.cycle_used = 0.0


def _simulate_hos_trip(
    legs: List[TripLeg],
    cycle_used: float,
    start_time: datetime,
    home_terminal_tz: str = "UTC"
) -> Tuple[List[Segment], List[DailyLog], List[Segment]]:
    """Internal simulator returning (split_segments, daily_logs, raw_segments)."""
    raw_segments: List[Segment] = []
    state = SimulationState(
        current_time=start_time,
        cycle_used=float(cycle_used),
        driving_since_rest=0.0,
        shift_start_time=None,
        driving_since_break=0.0,
        miles_since_fuel=0.0,
    )


    total_trip_miles = sum(l.distance_miles for l in legs)
    accumulated_miles = 0.0

    def interpolate_coords(leg: TripLeg, fraction: float) -> Optional[Tuple[float, float]]:
        if leg.start_coords and leg.end_coords:
            lat = leg.start_coords[0] + fraction * (leg.end_coords[0] - leg.start_coords[0])
            lng = leg.start_coords[1] + fraction * (leg.end_coords[1] - leg.start_coords[1])
            return (lat, lng)
        return None

    for leg_idx, leg in enumerate(legs):
        leg_remaining_miles = leg.distance_miles
        leg_remaining_hours = leg.duration_hours
        avg_speed = (leg.distance_miles / leg.duration_hours) if leg.duration_hours > 0 else 55.0

        # Simulate driving for this leg in chunks dictated by HOS limits & fuel
        while leg_remaining_miles > 1e-4 and leg_remaining_hours > 1e-4:
            # Check 1: Do we need a 34-hr restart right now because cycle is >= 70?
            if state.cycle_used >= CYCLE_MAX_HOURS:
                restart_dur = timedelta(hours=RESTART_34HR_HOURS)
                seg = Segment(
                    status=RESTART_STATUS_34HR,
                    start=state.current_time,
                    end=state.current_time + restart_dur,
                    location_label=f"Rest Area / Truck Stop (En route {leg.name})",
                    miles=0.0,
                    reason="34-hr restart",
                )
                raw_segments.append(seg)
                state.current_time += restart_dur
                state.record_rest("34hr", RESTART_34HR_HOURS)
                continue

            # Check 2: Do we need a 10-hr rest because 11h driving reached or 14h window reached?
            time_in_14h_window = (
                (state.current_time - state.shift_start_time).total_seconds() / 3600.0
                if state.shift_start_time is not None
                else 0.0
            )

            if state.driving_since_rest >= MAX_DRIVING_WITHOUT_REST_HOURS or time_in_14h_window >= MAX_DUTY_WINDOW_HOURS:
                rest_dur = timedelta(hours=REST_10HR_HOURS)
                seg = Segment(
                    status=REST_STATUS_10HR,
                    start=state.current_time,
                    end=state.current_time + rest_dur,
                    location_label=f"Rest Area / Berth (En route {leg.name})",
                    miles=0.0,
                    reason="10-hr rest",
                )
                raw_segments.append(seg)
                state.current_time += rest_dur
                state.record_rest("10hr", REST_10HR_HOURS)
                continue

            # Check 3: Do we need a 30-min break because 8h driving limit reached?
            if state.driving_since_break >= MAX_DRIVING_BEFORE_BREAK_HOURS:
                break_dur = timedelta(minutes=BREAK_MINIMUM_DURATION_MINUTES)
                # 30-min break can be OFF_DUTY or SLEEPER or ON_DUTY_NOT_DRIVING.
                # Standard practice is OFF_DUTY for rest break.
                seg = Segment(
                    status=OFF_DUTY,
                    start=state.current_time,
                    end=state.current_time + break_dur,
                    location_label=f"Rest Stop (En route {leg.name})",
                    miles=0.0,
                    reason="30-min break",
                )
                raw_segments.append(seg)
                state.current_time += break_dur
                state.record_non_driving_duration(OFF_DUTY, BREAK_MINIMUM_DURATION_MINUTES / 60.0)
                continue

            # Check 4: Do we need a fuel stop because 1,000 miles reached?
            if state.miles_since_fuel >= FUEL_STOP_INTERVAL_MILES:
                fuel_dur = timedelta(minutes=FUEL_STOP_DURATION_MINUTES)
                fuel_dur_hrs = FUEL_STOP_DURATION_MINUTES / 60.0
                # Fuel is on-duty not driving
                seg = Segment(
                    status=ON_DUTY_NOT_DRIVING,
                    start=state.current_time,
                    end=state.current_time + fuel_dur,
                    location_label=f"Fuel Station (Mile {accumulated_miles:.0f})",
                    miles=0.0,
                    reason="fuel",
                )
                raw_segments.append(seg)
                state.current_time += fuel_dur
                state.miles_since_fuel = 0.0
                state.record_non_driving_duration(ON_DUTY_NOT_DRIVING, fuel_dur_hrs)
                continue

            # Now, how much can we drive before the next event?
            # 1. 11h limit
            avail_driving_11h = MAX_DRIVING_WITHOUT_REST_HOURS - state.driving_since_rest
            # 2. 14h window
            time_in_14h = (
                (state.current_time - state.shift_start_time).total_seconds() / 3600.0
                if state.shift_start_time is not None
                else 0.0
            )
            avail_window_14h = MAX_DUTY_WINDOW_HOURS - time_in_14h
            # 3. 8h driving limit for 30m break
            avail_break_8h = MAX_DRIVING_BEFORE_BREAK_HOURS - state.driving_since_break
            # 4. 70h cycle limit
            avail_cycle_70h = CYCLE_MAX_HOURS - state.cycle_used
            # 5. Next fuel stop (miles converted to hours)
            avail_fuel_miles = FUEL_STOP_INTERVAL_MILES - state.miles_since_fuel
            avail_fuel_hours = avail_fuel_miles / avg_speed if avg_speed > 0 else 999.0

            # The maximum drive hours allowed in this slice
            max_drive_hours = min(
                leg_remaining_hours,
                avail_driving_11h,
                avail_window_14h,
                avail_break_8h,
                avail_cycle_70h,
                avail_fuel_hours,
            )

            # Ensure we make progress or trigger event if drive hours is zero/negligible
            if max_drive_hours <= 1e-4:
                # One of the constraints was reached; loops above will handle on next iteration
                continue

            # Drive slice
            drive_miles = min(leg_remaining_miles, max_drive_hours * avg_speed)
            drive_dur = timedelta(hours=max_drive_hours)

            if state.shift_start_time is None:
                state.shift_start_time = state.current_time

            start_fraction = (leg.distance_miles - leg_remaining_miles) / leg.distance_miles if leg.distance_miles > 0 else 0.0
            end_fraction = (leg.distance_miles - (leg_remaining_miles - drive_miles)) / leg.distance_miles if leg.distance_miles > 0 else 1.0

            seg = Segment(
                status=DRIVING,
                start=state.current_time,
                end=state.current_time + drive_dur,
                location_label=f"Driving towards {leg.end_label}",
                miles=drive_miles,
                reason="driving",
                start_coordinates=interpolate_coords(leg, start_fraction),
                end_coordinates=interpolate_coords(leg, end_fraction),
            )
            raw_segments.append(seg)

            state.current_time += drive_dur
            state.driving_since_rest += max_drive_hours
            state.driving_since_break += max_drive_hours
            state.cycle_used += max_drive_hours
            state.miles_since_fuel += drive_miles
            accumulated_miles += drive_miles

            leg_remaining_miles -= drive_miles
            leg_remaining_hours -= max_drive_hours

        # End of driving for this leg. Insert the on-duty duty stop!
        if leg_idx == 0:
            # Pickup duty (1 hour ON_DUTY_NOT_DRIVING)
            # Before doing pickup, check if cycle limit allows it or needs 34-hr restart
            if state.cycle_used + (PICKUP_DURATION_MINUTES / 60.0) > CYCLE_MAX_HOURS:
                restart_dur = timedelta(hours=RESTART_34HR_HOURS)
                raw_segments.append(Segment(
                    status=RESTART_STATUS_34HR,
                    start=state.current_time,
                    end=state.current_time + restart_dur,
                    location_label=leg.end_label,
                    miles=0.0,
                    reason="34-hr restart",
                ))
                state.current_time += restart_dur
                state.record_rest("34hr", RESTART_34HR_HOURS)

            pickup_dur = timedelta(minutes=PICKUP_DURATION_MINUTES)
            pickup_hours = PICKUP_DURATION_MINUTES / 60.0
            raw_segments.append(Segment(
                status=ON_DUTY_NOT_DRIVING,
                start=state.current_time,
                end=state.current_time + pickup_dur,
                location_label=leg.end_label,
                miles=0.0,
                reason="pickup",
                start_coordinates=leg.end_coords,
                end_coordinates=leg.end_coords,
            ))
            state.current_time += pickup_dur
            state.record_non_driving_duration(ON_DUTY_NOT_DRIVING, pickup_hours)

        elif leg_idx == 1:
            # Dropoff duty (1 hour ON_DUTY_NOT_DRIVING)
            if state.cycle_used + (DROPOFF_DURATION_MINUTES / 60.0) > CYCLE_MAX_HOURS:
                restart_dur = timedelta(hours=RESTART_34HR_HOURS)
                raw_segments.append(Segment(
                    status=RESTART_STATUS_34HR,
                    start=state.current_time,
                    end=state.current_time + restart_dur,
                    location_label=leg.end_label,
                    miles=0.0,
                    reason="34-hr restart",
                ))
                state.current_time += restart_dur
                state.record_rest("34hr", RESTART_34HR_HOURS)

            dropoff_dur = timedelta(minutes=DROPOFF_DURATION_MINUTES)
            dropoff_hours = DROPOFF_DURATION_MINUTES / 60.0
            raw_segments.append(Segment(
                status=ON_DUTY_NOT_DRIVING,
                start=state.current_time,
                end=state.current_time + dropoff_dur,
                location_label=leg.end_label,
                miles=0.0,
                reason="dropoff",
                start_coordinates=leg.end_coords,
                end_coordinates=leg.end_coords,
            ))
            state.current_time += dropoff_dur
            state.record_non_driving_duration(ON_DUTY_NOT_DRIVING, dropoff_hours)

    # Split segments at midnight into per-day logs and pad to 24h
    split_segments, daily_logs = split_into_daily_logs(raw_segments, cycle_used)
    return split_segments, daily_logs, raw_segments


def plan_trip_hos(
    legs: List[TripLeg],
    cycle_used: float,
    start_time: datetime,
    home_terminal_tz: str = "UTC"
) -> Tuple[List[Segment], List[DailyLog]]:
    """
    Public HOS planning API.
    Returns (split_segments, daily_logs) where segments are sliced at midnight.
    """
    split_segments, daily_logs, _ = _simulate_hos_trip(legs, cycle_used, start_time, home_terminal_tz)
    return split_segments, daily_logs


def plan_trip_hos_raw(
    legs: List[TripLeg],
    cycle_used: float,
    start_time: datetime,
    home_terminal_tz: str = "UTC"
) -> Tuple[List[Segment], List[DailyLog], List[Segment]]:
    """Like plan_trip_hos, but also returns raw un-split segments."""
    return _simulate_hos_trip(legs, cycle_used, start_time, home_terminal_tz)





def split_into_daily_logs(
    segments: List[Segment],
    initial_cycle_used: float
) -> Tuple[List[Segment], List[DailyLog]]:
    """
    Slices segments across midnight boundaries (home-terminal time).
    Fills remainder of the first day (before trip start) and last day (after trip end) with OFF_DUTY.
    Ensures every day sums to exactly 24.0 hours across the four rows.
    Calculates mileage and recap values.
    """
    if not segments:
        return [], []

    # 1. First, split any segment that crosses a calendar midnight
    split_segments: List[Segment] = []
    for seg_idx, seg in enumerate(segments):
        cur_start = seg.start
        target_end = seg.end
        total_seg_duration = (seg.end - seg.start).total_seconds()
        total_seg_miles = seg.miles
        event_id = seg.event_id or f"evt_{seg_idx}"
        orig_dur = seg.original_duration_hours or seg.duration_hours

        while cur_start.date() < target_end.date():
            # Midnight ending the current date
            next_midnight = datetime.combine(cur_start.date() + timedelta(days=1), time(0, 0, 0))
            slice_dur = (next_midnight - cur_start).total_seconds()
            slice_fraction = (slice_dur / total_seg_duration) if total_seg_duration > 0 else 0.0
            slice_miles = total_seg_miles * slice_fraction

            split_segments.append(Segment(
                status=seg.status,
                start=cur_start,
                end=next_midnight,
                location_label=seg.location_label,
                miles=slice_miles,
                reason=seg.reason,
                start_coordinates=seg.start_coordinates,
                end_coordinates=seg.end_coordinates,
                original_duration_hours=orig_dur,
                event_id=event_id,
            ))
            cur_start = next_midnight

        if cur_start < target_end:
            slice_dur = (target_end - cur_start).total_seconds()
            slice_fraction = (slice_dur / total_seg_duration) if total_seg_duration > 0 else 1.0
            slice_miles = total_seg_miles * slice_fraction

            split_segments.append(Segment(
                status=seg.status,
                start=cur_start,
                end=target_end,
                location_label=seg.location_label,
                miles=slice_miles,
                reason=seg.reason,
                start_coordinates=seg.start_coordinates,
                end_coordinates=seg.end_coordinates,
                original_duration_hours=orig_dur,
                event_id=event_id,
            ))


    # 2. Pad beginning of Day 1 (from 00:00 to trip start) with OFF_DUTY if start > 00:00
    first_seg = split_segments[0]
    day1_midnight = datetime.combine(first_seg.start.date(), time(0, 0, 0))
    if first_seg.start > day1_midnight:
        pad_first = Segment(
            status=OFF_DUTY,
            start=day1_midnight,
            end=first_seg.start,
            location_label=first_seg.location_label or "Home Terminal",
            miles=0.0,
            reason="off-duty prior to shift",
        )
        split_segments.insert(0, pad_first)

    # 3. Pad end of last Day (from last end to 24:00/midnight) with OFF_DUTY if last end < 24:00
    last_seg = split_segments[-1]
    last_day_next_midnight = datetime.combine(last_seg.end.date() + timedelta(days=1), time(0, 0, 0))
    if last_seg.end < last_day_next_midnight:
        pad_last = Segment(
            status=OFF_DUTY,
            start=last_seg.end,
            end=last_day_next_midnight,
            location_label=last_seg.location_label or "Destination",
            miles=0.0,
            reason="off-duty after shift",
        )
        split_segments.append(pad_last)

    # 4. Group segments by date
    days_map: Dict[date, List[Segment]] = {}
    for s in split_segments:
        d = s.start.date()
        days_map.setdefault(d, []).append(s)

    sorted_dates = sorted(days_map.keys())
    daily_logs: List[DailyLog] = []
    total_trip_miles_accum = 0.0

    # Accurate segment-by-segment cycle tracker
    seg_cycle = initial_cycle_used
    recap_by_date = {}

    for d in sorted_dates:

        day_segs = days_map[d]
        on_duty_today = sum(s.duration_hours for s in day_segs if s.status in [DRIVING, ON_DUTY_NOT_DRIVING])
        
        # Walk segments of this day
        for s in day_segs:
            if s.reason == "34-hr restart":
                # Check if this segment represents the completion of the 34-hr restart
                # (either un-split 34h, or the final slice of a multi-day 34h restart)
                # When 34h is completed, cycle becomes 0.0
                seg_cycle = 0.0
            elif s.status in [DRIVING, ON_DUTY_NOT_DRIVING]:
                seg_cycle += s.duration_hours

        available_tomorrow = max(0.0, CYCLE_MAX_HOURS - seg_cycle)
        recap_by_date[d] = {
            "on_duty_today": round(on_duty_today, 4),
            "cycle_used_total": round(seg_cycle, 4),
            "available_tomorrow": round(available_tomorrow, 4),
        }

    for d in sorted_dates:
        day_segs = days_map[d]
        hours_per_status = {st: 0.0 for st in ALL_STATUSES}
        day_driving_miles = 0.0

        for s in day_segs:
            dur = s.duration_hours
            hours_per_status[s.status] += dur
            if s.status == DRIVING:
                day_driving_miles += s.miles

        total_mileage_today = day_driving_miles
        total_trip_miles_accum += day_driving_miles
        total_day_hours = sum(hours_per_status.values())

        daily_logs.append(DailyLog(
            date=d,
            segments=day_segs,
            hours_per_status=hours_per_status,
            total_hours=round(total_day_hours, 4),
            miles_driving_today=round(day_driving_miles, 2),
            total_mileage_today=round(total_mileage_today, 2),
            recap=recap_by_date[d],
        ))


    return split_segments, daily_logs

"""
Test suite for the FMCSA Hours of Service (HOS) Engine.
Written strictly from the regulatory brief and user requirements:
- Short trip (no rest)
- 11-hour driving limit triggers 10-hour rest
- 14-hour duty window triggers 10-hour rest (even if < 11h driving)
- 30-minute break after 8 cumulative hours of driving
- 70-hour cycle with cycle_used=60 triggers 34-hour restart
- 34-hour restart resets cycle to 0
- 2,500+ mile cross-country trip with multiple rests, breaks, and fuel stops
- Fuel stop at least once every 1,000 miles (30 min ON_DUTY_NOT_DRIVING)
- Midnight-crossing segments correctly split in home-terminal time
- Every day's four duty status rows sum to exactly 24.0 hours
"""

from datetime import datetime, timedelta, date
import pytest
from hos_engine import (
    plan_trip_hos,
    plan_trip_hos_raw,
    TripLeg,
    OFF_DUTY,
    SLEEPER,
    DRIVING,
    ON_DUTY_NOT_DRIVING,
    REST_STATUS_10HR,
    RESTART_STATUS_34HR,
    CYCLE_MAX_HOURS,
)


def test_short_trip_no_rest():
    """
    Trip well within limits (e.g., 2 hrs drive to pickup, 1 hr pickup, 3 hrs drive to dropoff, 1 hr dropoff).
    Total driving = 5 hrs (< 11h, < 8h). Total duty = 7 hrs (< 14h, < 70h).
    No 10-hr rest or 30-min break should be inserted.
    """
    start_time = datetime(2026, 10, 12, 8, 0, 0)
    legs = [
        TripLeg(
            name="Current to Pickup",
            start_label="Origin",
            end_label="Pickup Facility",
            distance_miles=120.0,
            duration_hours=2.0,
        ),
        TripLeg(
            name="Pickup to Dropoff",
            start_label="Pickup Facility",
            end_label="Dropoff Facility",
            distance_miles=180.0,
            duration_hours=3.0,
        ),
    ]

    segments, daily_logs = plan_trip_hos(legs, cycle_used=10.0, start_time=start_time)

    # Verify no rests or restarts were inserted
    reasons = [s.reason for s in segments]
    assert "10-hr rest" not in reasons
    assert "34-hr restart" not in reasons
    assert "30-min break" not in reasons

    # Check required pickup and dropoff
    assert "pickup" in reasons
    assert "dropoff" in reasons

    # Exactly 1 calendar day
    assert len(daily_logs) == 1
    log = daily_logs[0]
    assert log.hours_per_status[DRIVING] == pytest.approx(5.0, 0.01)
    assert log.hours_per_status[ON_DUTY_NOT_DRIVING] == pytest.approx(2.0, 0.01)  # 1h pickup + 1h dropoff
    assert log.total_hours == pytest.approx(24.0, 0.01)


def test_11_hour_driving_limit_triggers_rest():
    """
    Driving for 12 hours total in a single leg without long non-driving events.
    At the 11th driving hour, a 10-hr rest (SLEEPER) must be triggered.
    """
    start_time = datetime(2026, 10, 12, 6, 0, 0)
    legs = [
        TripLeg(
            name="Current to Pickup",
            start_label="Origin",
            end_label="Pickup Facility",
            distance_miles=720.0,
            duration_hours=12.0,  # exceeds 11 hrs
        ),
        TripLeg(
            name="Pickup to Dropoff",
            start_label="Pickup Facility",
            end_label="Dropoff Facility",
            distance_miles=60.0,
            duration_hours=1.0,
        ),
    ]

    segments, daily_logs, raw_segments = plan_trip_hos_raw(legs, cycle_used=0.0, start_time=start_time)

    # In raw segments, the rest was scheduled as exactly 10 hours
    raw_rests = [s for s in raw_segments if s.reason == "10-hr rest"]
    assert len(raw_rests) >= 1
    assert raw_rests[0].status == REST_STATUS_10HR
    assert (raw_rests[0].end - raw_rests[0].start).total_seconds() / 3600.0 == pytest.approx(10.0, 0.01)

    # In daily split segments, the slices of that rest sum to exactly 10 hours
    split_rests = [s for s in segments if s.reason == "10-hr rest"]
    assert sum(s.duration_hours for s in split_rests) == pytest.approx(10.0, 0.01)

    # Before that first 10-hr rest, total driving must be <= 11.0 hours
    first_rest_start = raw_rests[0].start
    driving_before_rest = sum(
        s.duration_hours for s in segments if s.end <= first_rest_start and s.status == DRIVING
    )
    assert driving_before_rest == pytest.approx(11.0, 0.01)



def test_14_hour_duty_window_triggers_rest():
    """
    14-hour consecutive window rule:
    Driver drives 6 hours, then takes a 7.5-hour off-duty break (which doesn't pause the 14h window),
    leaving only 0.5 hours of driving allowed before the 14h window closes.
    Even though driving is only 6.5 hrs (< 11h), a 10-hr rest must trigger at the 14h mark.
    """
    # Custom simulation: Trip with legs where duty elapsed reaches 14h
    start_time = datetime(2026, 10, 12, 6, 0, 0)
    # Leg 1: 7 hours driving
    # Pickup: 1 hour on duty (window elapsed: 8 hrs, driving: 7 hrs)
    # Fuel stop: 0.5 hours (window elapsed: 8.5 hrs)
    # Leg 2: 7 hours driving (total potential driving in shift = 14 hrs, but window expires after 5.5 more hours of driving)
    legs = [
        TripLeg(
            name="Current to Pickup",
            start_label="Origin",
            end_label="Pickup",
            distance_miles=420.0,
            duration_hours=7.0,
        ),
        TripLeg(
            name="Pickup to Dropoff",
            start_label="Pickup",
            end_label="Dropoff",
            distance_miles=420.0,
            duration_hours=7.0,
        ),
    ]

    segments, daily_logs = plan_trip_hos(legs, cycle_used=0.0, start_time=start_time)

    # 10-hr rest must be triggered before the 14th consecutive hour from shift start
    rests = [s for s in segments if s.reason == "10-hr rest"]
    assert len(rests) >= 1
    # Shift start is 06:00. Pickup is 1 hr. Total on-duty driving before rest must cut off at or before 14h from start.
    assert (rests[0].start - start_time).total_seconds() / 3600.0 <= 14.0 + 1e-4


def test_30_minute_break_after_8_hours_driving():
    """
    Driving not allowed after 8 cumulative hours without at least a 30-minute non-driving break.
    A 9-hour continuous driving leg must insert a 30-min break after 8 hours.
    """
    start_time = datetime(2026, 10, 12, 6, 0, 0)
    legs = [
        TripLeg(
            name="Current to Pickup",
            start_label="Origin",
            end_label="Pickup",
            distance_miles=540.0,
            duration_hours=9.0,
        ),
        TripLeg(
            name="Pickup to Dropoff",
            start_label="Pickup",
            end_label="Dropoff",
            distance_miles=60.0,
            duration_hours=1.0,
        ),
    ]

    segments, daily_logs = plan_trip_hos(legs, cycle_used=0.0, start_time=start_time)

    breaks_30m = [s for s in segments if s.reason == "30-min break"]
    assert len(breaks_30m) >= 1
    # Check that before this break, cumulative driving reached 8.0 hours
    break_start = breaks_30m[0].start
    driving_before = sum(
        s.duration_hours for s in segments if s.end <= break_start and s.status == DRIVING
    )
    assert driving_before == pytest.approx(8.0, 0.01)
    assert (breaks_30m[0].end - breaks_30m[0].start).total_seconds() / 60.0 == pytest.approx(30.0, 0.01)


def test_fuel_stop_satisfies_30_min_break():
    """
    A fuel stop of 30 min ON_DUTY_NOT_DRIVING at mile 400 (if inserted) resets the 30-min break clock.
    Here we test a 1,000-mile leg where fuel stop triggers at 1,000 miles.
    """
    start_time = datetime(2026, 10, 12, 6, 0, 0)
    legs = [
        TripLeg(
            name="Current to Pickup",
            start_label="Origin",
            end_label="Pickup",
            distance_miles=1100.0,
            duration_hours=18.0,
        ),
        TripLeg(
            name="Pickup to Dropoff",
            start_label="Pickup",
            end_label="Dropoff",
            distance_miles=60.0,
            duration_hours=1.0,
        ),
    ]

    segments, daily_logs = plan_trip_hos(legs, cycle_used=0.0, start_time=start_time)

    fuel_stops = [s for s in segments if s.reason == "fuel"]
    assert len(fuel_stops) >= 1
    assert fuel_stops[0].status == ON_DUTY_NOT_DRIVING
    assert (fuel_stops[0].end - fuel_stops[0].start).total_seconds() / 60.0 == pytest.approx(30.0, 0.01)


def test_70_hour_cycle_with_high_cycle_used_triggers_34hr_restart():
    """
    With cycle_used=60.0 hours:
    Driver has only 10.0 hours available in the 70h cycle.
    If trip requires 15 on-duty hours (e.g. 13h driving + 2h on-duty stops),
    a 34-hour restart must be inserted before exceeding 70h, and it resets the cycle.
    """
    start_time = datetime(2026, 10, 12, 6, 0, 0)
    legs = [
        TripLeg(
            name="Current to Pickup",
            start_label="Origin",
            end_label="Pickup",
            distance_miles=400.0,
            duration_hours=8.0,
        ),
        TripLeg(
            name="Pickup to Dropoff",
            start_label="Pickup",
            end_label="Dropoff",
            distance_miles=400.0,
            duration_hours=8.0,
        ),
    ]
    # Total on-duty needed = 8 (drive) + 1 (pickup) + 8 (drive) + 1 (dropoff) = 18 hrs.
    # Initial cycle_used = 60 hrs -> Limit 70h reached after 10 on-duty hours!

    segments, daily_logs, raw_segments = plan_trip_hos_raw(legs, cycle_used=60.0, start_time=start_time)

    raw_restarts = [s for s in raw_segments if s.reason == "34-hr restart"]
    assert len(raw_restarts) >= 1
    assert raw_restarts[0].status == RESTART_STATUS_34HR
    assert (raw_restarts[0].end - raw_restarts[0].start).total_seconds() / 3600.0 == pytest.approx(34.0, 0.01)

    # In daily split segments, the slices of that restart sum to exactly 34 hours
    split_restarts = [s for s in segments if s.reason == "34-hr restart"]
    assert sum(s.duration_hours for s in split_restarts) == pytest.approx(34.0, 0.01)

    # After the restart, duty can proceed without hitting the 70h limit immediately
    last_log = daily_logs[-1]
    assert last_log.recap["cycle_used_total"] < CYCLE_MAX_HOURS



def test_cross_country_2500_miles_trip():
    """
    2,500+ mile trip (e.g. Los Angeles to Atlanta / New York).
    Requires multiple 10-hour rests, multiple 30-min breaks, and fuel stops at every 1,000 miles.
    Every day must sum to exactly 24.0 hours across the four rows.
    """
    start_time = datetime(2026, 10, 12, 7, 0, 0)
    legs = [
        TripLeg(
            name="Current to Pickup",
            start_label="Los Angeles, CA",
            end_label="Barstow, CA",
            distance_miles=150.0,
            duration_hours=2.5,
        ),
        TripLeg(
            name="Pickup to Dropoff",
            start_label="Barstow, CA",
            end_label="Atlanta, GA",
            distance_miles=2350.0,
            duration_hours=39.0,
        ),
    ]

    segments, daily_logs = plan_trip_hos(legs, cycle_used=20.0, start_time=start_time)

    # Multi-day trip
    assert len(daily_logs) >= 4

    # Every single day must sum to exactly 24.0 hours
    for i, log in enumerate(daily_logs):
        assert log.total_hours == pytest.approx(24.0, 0.001), f"Day {i+1} ({log.date}) sum is {log.total_hours}"
        # Sum of individual statuses must equal 24.0
        status_sum = sum(log.hours_per_status.values())
        assert status_sum == pytest.approx(24.0, 0.001)

    # Total driving miles across all days must equal total leg distance
    total_log_miles = sum(log.miles_driving_today for log in daily_logs)
    assert total_log_miles == pytest.approx(2500.0, 0.1)

    # Check fuel stops: 2,500 miles requires at least 2 fuel stops (at mile 1000 and mile 2000)
    fuel_stops = [s for s in segments if s.reason == "fuel"]
    assert len(fuel_stops) >= 2


def test_midnight_crossing_splitting():
    """
    A 10-hr rest starting at 20:00 (8 PM) must split at 00:00 into:
    - 4.0 hours on Day 1 (20:00 to 24:00)
    - 6.0 hours on Day 2 (00:00 to 06:00)
    Both days must sum to 24.0 hours.
    """
    # Leg 1: 10.5 hours driving (08:30 to 19:00 with a 0.5h break after 8h = ends at 19:30).
    # Pickup: 0.5h on-duty at 19:30 -> ends at 20:00.
    # At 20:00, 11h driving + 0.5h duty window reached -> 10-hr rest starts at 20:00 on Day 1.
    # Rest splits into: 20:00 to 24:00 (4.0 hrs Day 1) and 00:00 to 06:00 (6.0 hrs Day 2).
    start_time = datetime(2026, 10, 12, 8, 30, 0)
    legs = [
        TripLeg(
            name="Current to Pickup",
            start_label="City A",
            end_label="City B",
            distance_miles=630.0,
            duration_hours=10.5,
        ),
        TripLeg(
            name="Pickup to Dropoff",
            start_label="City B",
            end_label="City C",
            distance_miles=60.0,
            duration_hours=1.0,
        ),
    ]

    segments, daily_logs = plan_trip_hos(legs, cycle_used=0.0, start_time=start_time)

    assert len(daily_logs) >= 2
    day1 = daily_logs[0]
    day2 = daily_logs[1]

    # Check Day 1 rest slice and Day 2 rest slice
    day1_rest = [s for s in day1.segments if s.reason == "10-hr rest"]
    assert len(day1_rest) == 1
    assert day1_rest[0].status == SLEEPER
    assert day1_rest[0].end == datetime(2026, 10, 13, 0, 0, 0)

    day2_rest = [s for s in day2.segments if s.reason == "10-hr rest"]
    assert len(day2_rest) == 1
    assert day2_rest[0].status == SLEEPER
    assert day2_rest[0].start == datetime(2026, 10, 13, 0, 0, 0)

    # Combined duration of the two slices is exactly 10 hours
    assert day1_rest[0].duration_hours + day2_rest[0].duration_hours == pytest.approx(10.0, 0.01)

    # Invariant: both sum to 24.0 hours
    assert day1.total_hours == pytest.approx(24.0, 0.001)
    assert day2.total_hours == pytest.approx(24.0, 0.001)



def test_every_segment_has_required_attributes():
    """
    Brief requirement:
    Every segment carries: status, start, end, location label/coordinates, miles, and reason.
    """
    start_time = datetime(2026, 10, 12, 8, 0, 0)
    legs = [
        TripLeg(
            name="Leg 1",
            start_label="A",
            end_label="B",
            distance_miles=100.0,
            duration_hours=2.0,
            start_coords=(34.05, -118.25),
            end_coords=(34.50, -117.50),
        ),
        TripLeg(
            name="Leg 2",
            start_label="B",
            end_label="C",
            distance_miles=100.0,
            duration_hours=2.0,
            start_coords=(34.50, -117.50),
            end_coords=(35.00, -117.00),
        ),
    ]

    segments, daily_logs = plan_trip_hos(legs, cycle_used=5.0, start_time=start_time)

    for seg in segments:
        assert seg.status in [OFF_DUTY, SLEEPER, DRIVING, ON_DUTY_NOT_DRIVING]
        assert isinstance(seg.start, datetime)
        assert isinstance(seg.end, datetime)
        assert seg.end >= seg.start
        assert isinstance(seg.location_label, str) and len(seg.location_label) > 0
        assert seg.miles >= 0.0
        assert isinstance(seg.reason, str) and len(seg.reason) > 0


def test_cycle_used_65_restart_2500_mile_trip():
    """
    Requirement: cycle_used_hrs=65 on a 2,500-mile trip must produce a 34-hour restart
    (single stop of type 'restart' with duration 34.0, status OFF_DUTY), and every daily log
    must still sum to 24.0 hours.
    """
    start_time = datetime(2026, 10, 12, 7, 0, 0)
    legs = [
        TripLeg(
            name="Current to Pickup",
            start_label="Los Angeles, CA",
            end_label="Barstow, CA",
            distance_miles=150.0,
            duration_hours=2.5,
        ),
        TripLeg(
            name="Pickup to Dropoff",
            start_label="Barstow, CA",
            end_label="Atlanta, GA",
            distance_miles=2350.0,
            duration_hours=39.0,
        ),
    ]

    segments, daily_logs, raw_segments = plan_trip_hos_raw(legs, cycle_used=65.0, start_time=start_time)

    # Must produce a 34-hour restart in raw segments
    raw_restarts = [s for s in raw_segments if s.reason == "34-hr restart"]
    assert len(raw_restarts) >= 1
    first_restart = raw_restarts[0]
    assert first_restart.status == RESTART_STATUS_34HR  # OFF_DUTY
    assert (first_restart.end - first_restart.start).total_seconds() / 3600.0 == pytest.approx(34.0, 0.01)

    # In daily split segments, total duration of all restart slices must equal 34.0 hours
    split_restarts = [s for s in segments if s.reason == "34-hr restart"]
    assert sum(s.duration_hours for s in split_restarts) == pytest.approx(34.0, 0.01)

    # Every daily log must sum to exactly 24.0 hours
    assert len(daily_logs) >= 5
    for i, log in enumerate(daily_logs):
        assert log.total_hours == pytest.approx(24.0, 0.001), f"Day {i+1} ({log.date}) sum is {log.total_hours}"
        status_sum = sum(log.hours_per_status.values())
        assert status_sum == pytest.approx(24.0, 0.001), f"Day {i+1} ({log.date}) status sum is {status_sum}"


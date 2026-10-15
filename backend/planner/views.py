"""
API Views for ELD Trip Planner:
- GET /api/geocode/?q= : Nominatim search returning up to 5 location candidates
- POST /api/plan-trip/ : Plans complete trip route, HOS simulation, stop waypoints with interpolated lat/lng, and daily logs
"""

from __future__ import annotations
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import time
from typing import Dict, Any

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from hos_engine import plan_trip_hos_raw, TripLeg
from planner.services import (
    geocode_address,
    reverse_geocode_location,
    resolve_timezone,
    get_two_leg_route,
    interpolate_along_polyline,
)



PLANNER_ASSUMPTIONS = [
    "Property-carrying driver, 70 hrs / 8 days cycle, no adverse driving conditions.",
    "Trip order: current location -> pickup (driving) -> pickup (1 hr on-duty) -> dropoff (driving) -> dropoff (1 hr on-duty).",
    "Fuel stop inserted at least once every 1,000 miles (30 minutes on-duty not driving).",
    "30-minute break required after 8 cumulative hours of driving; satisfied by any 30+ min non-driving period (fuel stops and pickup/dropoff qualify).",
    "11-hour driving limit resets after 10 consecutive hours rest (status = SLEEPER).",
    "14-hour duty window starts upon coming on duty after a 10-hour rest and does not pause for breaks or off-duty periods.",
    "70-hour cycle tracks cumulative on-duty time starting from cycle_used_hrs. No hours roll off during the trip (conservative simplification).",
    "Reaching 70 hours triggers a 34-hour off-duty restart (status = OFF_DUTY), resetting the cycle to 0 hours.",
    "All segments are sliced exactly at midnight in the origin's home-terminal timezone.",
    "Every day's four duty status rows sum to exactly 24.0 hours.",
]


class GeocodeView(APIView):
    """Search / autocomplete addresses via Nominatim."""
    def get(self, request):
        query = request.query_params.get("q", "").strip()
        if not query:
            return Response([], status=status.HTTP_200_OK)
        candidates = geocode_address(query, limit=5)
        return Response(candidates, status=status.HTTP_200_OK)


class HealthView(APIView):
    """
    GET /api/health/
    Zero-dependency liveness probe — no DB, no external calls.
    Used for warm-up pings on Render's free tier and uptime monitoring.
    """
    def get(self, request):
        return Response({"status": "ok"}, status=status.HTTP_200_OK)


class PlanTripView(APIView):
    """
    Plan a full ELD trip:
    Inputs:
    - current: { label, lat, lng }
    - pickup: { label, lat, lng }
    - dropoff: { label, lat, lng }
    - cycle_used_hrs: float (0 to 70)
    - start_datetime: Optional ISO 8601 string
    """
    def post(self, request):
        data = request.data or {}
        errors: Dict[str, str] = {}

        # Validate current, pickup, dropoff
        current = data.get("current")
        pickup = data.get("pickup")
        dropoff = data.get("dropoff")

        for name, val in [("current", current), ("pickup", pickup), ("dropoff", dropoff)]:
            if not val:
                errors[name] = f"Field '{name}' is required."
            elif not isinstance(val, dict):
                errors[name] = f"Field '{name}' must be an object with label, lat, and lng."
            else:
                if "lat" not in val or "lng" not in val:
                    errors[name] = f"Field '{name}' must contain lat and lng."
                else:
                    try:
                        val["lat"] = float(val["lat"])
                        val["lng"] = float(val["lng"])
                    except (ValueError, TypeError):
                        errors[name] = f"Field '{name}' lat and lng must be numbers."

        # Validate cycle_used_hrs
        cycle_used_raw = data.get("cycle_used_hrs")
        if cycle_used_raw is None:
            errors["cycle_used_hrs"] = "Field 'cycle_used_hrs' is required."
        else:
            try:
                cycle_used = float(cycle_used_raw)
                if cycle_used < 0.0 or cycle_used > 70.0:
                    errors["cycle_used_hrs"] = "Field 'cycle_used_hrs' must be between 0 and 70."
            except (ValueError, TypeError):
                errors["cycle_used_hrs"] = "Field 'cycle_used_hrs' must be a valid number."

        if errors:
            return Response({"errors": errors}, status=status.HTTP_400_BAD_REQUEST)

        # Resolve origin timezone
        origin_tz_name = resolve_timezone(current["lat"], current["lng"])
        try:
            origin_tz = ZoneInfo(origin_tz_name)
        except Exception:
            origin_tz_name = "UTC"
            origin_tz = ZoneInfo("UTC")

        # Parse start_datetime or default to now
        start_datetime_raw = data.get("start_datetime")
        if start_datetime_raw:
            try:
                dt_parsed = datetime.fromisoformat(start_datetime_raw)
                if dt_parsed.tzinfo is None:
                    # Assume user provided local origin time
                    start_local_naive = dt_parsed
                else:
                    # Convert to origin timezone and make naive for engine
                    dt_local = dt_parsed.astimezone(origin_tz)
                    start_local_naive = dt_local.replace(tzinfo=None)
            except Exception:
                return Response(
                    {"errors": {"start_datetime": "Invalid ISO 8601 datetime format."}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            now_origin = datetime.now(origin_tz).replace(tzinfo=None)
            # Round up to next 15-minute boundary
            minute_remainder = now_origin.minute % 15
            second_remainder = now_origin.second or now_origin.microsecond
            if minute_remainder != 0 or second_remainder != 0:
                mins_to_add = 15 - minute_remainder
                now_rounded = (now_origin + timedelta(minutes=mins_to_add)).replace(second=0, microsecond=0)
            else:
                now_rounded = now_origin.replace(second=0, microsecond=0)
            start_local_naive = now_rounded

        # Fetch route
        try:
            route_data = get_two_leg_route(current, pickup, dropoff)
        except ConnectionError as conn_err:
            return Response(
                {"error": "Routing service unavailable", "details": str(conn_err)},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except Exception as exc:
            return Response(
                {"error": "Failed to calculate route", "details": str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        # Prepare legs for HOS engine
        leg1 = TripLeg(
            name="Current to Pickup",
            start_label=current.get("label", "Current Location"),
            end_label=pickup.get("label", "Pickup Facility"),
            distance_miles=route_data["legs"][0]["distance_miles"],
            duration_hours=route_data["legs"][0]["duration_hours"],
            start_coords=route_data["legs"][0]["start_coords"],
            end_coords=route_data["legs"][0]["end_coords"],
        )
        leg2 = TripLeg(
            name="Pickup to Dropoff",
            start_label=pickup.get("label", "Pickup Facility"),
            end_label=dropoff.get("label", "Dropoff Facility"),
            distance_miles=route_data["legs"][1]["distance_miles"],
            duration_hours=route_data["legs"][1]["duration_hours"],
            start_coords=route_data["legs"][1]["start_coords"],
            end_coords=route_data["legs"][1]["end_coords"],
        )

        # Execute HOS engine returning daily logs AND unsplit raw segments
        split_segments, daily_logs, raw_segments = plan_trip_hos_raw(
            legs=[leg1, leg2],
            cycle_used=cycle_used,
            start_time=start_local_naive,
            home_terminal_tz=origin_tz_name,
        )

        # Extract stops from UNSPLIT raw segments with precise coordinates interpolated along route polyline
        all_coords = route_data["all_coordinates"]
        stops = []
        accumulated_miles = 0.0

        # Reverse geocode stops with an 8-second total budget
        rev_geo_start_time = time.time()
        rev_geo_budget_seconds = 8.0

        for seg in raw_segments:
            if seg.status == "DRIVING":
                accumulated_miles += seg.miles
                continue

            # Non-driving stops: pickup, dropoff, fuel, 30-min break, 10-hr rest, 34-hr restart
            if seg.reason in ("off-duty prior to shift", "off-duty after shift"):
                continue

            stop_type = "rest"
            if seg.reason == "pickup":
                stop_type = "pickup"
                lat, lng = pickup["lat"], pickup["lng"]
                stop_label = pickup.get("label", "Pickup Facility")
            elif seg.reason == "dropoff":
                stop_type = "dropoff"
                lat, lng = dropoff["lat"], dropoff["lng"]
                stop_label = dropoff.get("label", "Dropoff Facility")
            else:
                if seg.reason == "fuel":
                    stop_type = "fuel"
                elif seg.reason == "30-min break":
                    stop_type = "break"
                elif seg.reason == "10-hr rest":
                    stop_type = "rest"
                elif seg.reason == "34-hr restart":
                    stop_type = "restart"
                lat, lng = interpolate_along_polyline(all_coords, accumulated_miles)

                # Attempt reverse-geocoding within budget
                resolved_place = None
                time_elapsed = time.time() - rev_geo_start_time
                if time_elapsed < rev_geo_budget_seconds:
                    rem_time = max(0.5, rev_geo_budget_seconds - time_elapsed)
                    resolved_place = reverse_geocode_location(lat, lng, timeout=min(2.0, rem_time))

                if resolved_place:
                    stop_label = resolved_place
                else:
                    stop_label = f"Mile {accumulated_miles:.0f}"

            stops.append({
                "type": stop_type,
                "lat": round(lat, 5),
                "lng": round(lng, 5),
                "eta_start": seg.start.isoformat(),
                "eta_end": seg.end.isoformat(),
                "duration_hrs": round(seg.duration_hours, 2),
                "label": stop_label,
                "reason": seg.reason,
            })



        # Assign accurate from_city and to_city to each daily log
        # Day 1 starts at current location; subsequent days start at previous day's ending location
        prev_location = current.get("label", "Current Location").split(",")[0] + ", " + current.get("label", "").split(",")[-1].strip() if "," in current.get("label", "") else current.get("label", "Origin")
        for i, dlog in enumerate(daily_logs):
            dlog.from_city = prev_location
            # Determine this day's ending location: last stop or destination
            # If this is the final day, it ends at dropoff
            if i == len(daily_logs) - 1:
                end_loc = dropoff.get("label", "Destination").split(",")[0] + ", " + dropoff.get("label", "").split(",")[-1].strip() if "," in dropoff.get("label", "") else dropoff.get("label", "Destination")
            else:
                # Find last stop or segment on this day
                day_stops = [s for s in stops if s["eta_start"].startswith(dlog.date.isoformat()) or s["eta_end"].startswith(dlog.date.isoformat())]
                if day_stops:
                    end_loc = day_stops[-1]["label"]
                else:
                    end_loc = prev_location
            dlog.to_city = end_loc
            prev_location = end_loc

        response_payload = {
            "route": {
                "geojson": route_data["geojson"],
                "total_miles": route_data["total_miles"],
                "total_drive_hours": route_data["total_drive_hours"],
                "legs": route_data["legs"],
            },
            "stops": stops,

            "daily_logs": [log.to_dict() for log in daily_logs],
            "timezone": origin_tz_name,
            "assumptions": PLANNER_ASSUMPTIONS,
        }

        return Response(response_payload, status=status.HTTP_200_OK)

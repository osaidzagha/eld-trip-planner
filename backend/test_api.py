"""
Test suite for ELD Trip Planner API endpoints:
- Validation errors (missing fields, invalid cycle_used_hrs, bad coordinates) -> 400
- Polyline distance interpolation on known coordinate geometry
- Mocked 2-leg routing plan producing expected stops, GeoJSON, and daily_logs -> 200
- Routing network failure / timeout -> clean 502 with message
- Cache hit verification (second identical call avoids external routing request)
- Geocode autocomplete endpoint
"""

import json
from unittest.mock import patch, MagicMock
import pytest
from django.core.cache import cache
from rest_framework.test import APIClient
from planner.services import interpolate_along_polyline, haversine_distance_miles


@pytest.fixture(autouse=True)
def clear_django_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def client():
    return APIClient()


def test_validation_missing_locations(client):
    """Missing current, pickup, or dropoff returns 400 with field errors."""
    payload = {
        "current": {"label": "LA", "lat": 34.05, "lng": -118.25},
        # pickup missing
        "dropoff": {"label": "NY", "lat": 40.71, "lng": -74.00},
        "cycle_used_hrs": 15.0,
    }
    response = client.post("/api/plan-trip/", data=payload, format="json")
    assert response.status_code == 400
    data = response.json()
    assert "errors" in data
    assert "pickup" in data["errors"]


def test_validation_cycle_used_out_of_bounds(client):
    """cycle_used_hrs < 0 or > 70 returns 400."""
    payload = {
        "current": {"label": "LA", "lat": 34.05, "lng": -118.25},
        "pickup": {"label": "Denver", "lat": 39.73, "lng": -104.99},
        "dropoff": {"label": "NY", "lat": 40.71, "lng": -74.00},
        "cycle_used_hrs": 75.0,  # Invalid (>70)
    }
    response = client.post("/api/plan-trip/", data=payload, format="json")
    assert response.status_code == 400
    data = response.json()
    assert "cycle_used_hrs" in data["errors"]


def test_interpolation_known_polyline():
    """Verify interpolation along a known 2-point north-south line."""
    # From (30.0, -90.0) to (31.0, -90.0)
    p1 = (30.0, -90.0)
    p2 = (31.0, -90.0)
    total_dist = haversine_distance_miles(p1, p2)
    assert total_dist > 60.0  # Approx 69 miles per degree of latitude

    polyline = [p1, p2]

    # At 0 miles, must be p1
    at_start = interpolate_along_polyline(polyline, 0.0)
    assert at_start == pytest.approx(p1, 0.001)

    # At total_dist, must be p2
    at_end = interpolate_along_polyline(polyline, total_dist)
    assert at_end == pytest.approx(p2, 0.001)

    # At midpoint, latitude must be exactly 30.5
    at_mid = interpolate_along_polyline(polyline, total_dist / 2.0)
    assert at_mid[0] == pytest.approx(30.5, 0.001)
    assert at_mid[1] == pytest.approx(-90.0, 0.001)


def test_plan_trip_mocked_success(client):
    """
    Test mocked 2-leg trip plan returns GeoJSON, stops, and daily logs.
    """
    mock_route_result = {
        "geojson": {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [[-87.62, 41.87], [-96.79, 32.77], [-84.38, 33.74]],
            },
            "properties": {"total_miles": 1720.0, "total_duration_hours": 26.0},
        },
        "total_miles": 1720.0,
        "total_drive_hours": 26.0,
        "legs": [
            {
                "name": "Current to Pickup",
                "distance_miles": 920.0,
                "duration_hours": 14.0,
                "start_coords": (41.87, -87.62),
                "end_coords": (32.77, -96.79),
            },
            {
                "name": "Pickup to Dropoff",
                "distance_miles": 800.0,
                "duration_hours": 12.0,
                "start_coords": (32.77, -96.79),
                "end_coords": (33.74, -84.38),
            },
        ],
        "all_coordinates": [(41.87, -87.62), (32.77, -96.79), (33.74, -84.38)],
    }

    payload = {
        "current": {"label": "Chicago, IL", "lat": 41.87, "lng": -87.62},
        "pickup": {"label": "Dallas, TX", "lat": 32.77, "lng": -96.79},
        "dropoff": {"label": "Atlanta, GA", "lat": 33.74, "lng": -84.38},
        "cycle_used_hrs": 30.0,
        "start_datetime": "2026-10-12T08:00:00",
    }

    with patch("planner.views.get_two_leg_route", return_value=mock_route_result):
        response = client.post("/api/plan-trip/", data=payload, format="json")

    assert response.status_code == 200
    data = response.json()

    assert "route" in data
    assert data["route"]["total_miles"] == 1720.0
    assert "stops" in data
    assert len(data["stops"]) >= 2  # At least pickup and dropoff

    # Verify pickup stop
    pickup_stops = [s for s in data["stops"] if s["type"] == "pickup"]
    assert len(pickup_stops) == 1
    assert pickup_stops[0]["duration_hrs"] == 1.0

    # Verify daily logs
    assert "daily_logs" in data
    assert len(data["daily_logs"]) >= 2
    for log in data["daily_logs"]:
        assert log["total_hours"] == pytest.approx(24.0, 0.01)

    assert "timezone" in data
    assert "assumptions" in data


def test_plan_trip_routing_failure_returns_502(client):
    """When routing service throws ConnectionError, return clean 502 with message."""
    payload = {
        "current": {"label": "Chicago, IL", "lat": 41.87, "lng": -87.62},
        "pickup": {"label": "Dallas, TX", "lat": 32.77, "lng": -96.79},
        "dropoff": {"label": "Atlanta, GA", "lat": 33.74, "lng": -84.38},
        "cycle_used_hrs": 30.0,
    }

    with patch("planner.views.get_two_leg_route", side_effect=ConnectionError("OSRM timed out")):
        response = client.post("/api/plan-trip/", data=payload, format="json")

    assert response.status_code == 502
    data = response.json()
    assert "error" in data
    assert "details" in data
    assert "OSRM timed out" in data["details"]


def test_routing_cache_hit_avoids_second_call():
    """Identical routing requests hit Django cache without calling upstream service."""
    from planner.services import get_two_leg_route

    curr = {"lat": 41.8781, "lng": -87.6298}
    pick = {"lat": 32.7767, "lng": -96.7970}
    drop = {"lat": 33.7490, "lng": -84.3880}

    dummy_res = {
        "geojson": {},
        "total_miles": 100.0,
        "total_drive_hours": 2.0,
        "legs": [],
        "all_coordinates": [],
    }

    with patch("planner.services._fetch_route_osrm", return_value=dummy_res) as mock_osrm:
        # First call: cache miss, calls _fetch_route_osrm
        res1 = get_two_leg_route(curr, pick, drop)
        assert mock_osrm.call_count == 1

        # Second call: cache hit, should NOT call _fetch_route_osrm again
        res2 = get_two_leg_route(curr, pick, drop)
        assert mock_osrm.call_count == 1
        assert res1 == res2


def test_geocode_endpoint(client):
    """GET /api/geocode/?q=Chicago returns up to 5 candidates."""
    mock_nominatim = [
        {"label": "Chicago, Cook County, Illinois, United States", "lat": 41.8781, "lng": -87.6298}
    ]
    with patch("planner.views.geocode_address", return_value=mock_nominatim):
        response = client.get("/api/geocode/?q=Chicago")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["lat"] == 41.8781


def test_stops_built_from_unsplit_events(client):
    """
    Stops must be built from the unsplit event stream.
    A 10-hour rest crossing midnight is ONE stop with duration_hrs = 10.0,
    rather than two split stops.
    """
    # Chicago -> Dallas -> Atlanta with real distances:
    # Expect 7 stops: break, rest, pickup, fuel, rest, break, dropoff
    mock_route_result = {
        "geojson": {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [[-87.62, 41.87], [-84.38, 33.74]]},
            "properties": {"total_miles": 1749.61, "total_duration_hours": 31.25},
        },
        "total_miles": 1749.61,
        "total_drive_hours": 31.25,
        "legs": [
            {
                "name": "Current to Pickup",
                "distance_miles": 966.9,
                "duration_hours": 17.1,
                "start_coords": (41.8781, -87.6298),
                "end_coords": (32.7767, -96.7970),
            },
            {
                "name": "Pickup to Dropoff",
                "distance_miles": 782.71,
                "duration_hours": 14.15,
                "start_coords": (32.7767, -96.7970),
                "end_coords": (33.7490, -84.3880),
            },
        ],
        "all_coordinates": [(41.8781, -87.6298), (32.7767, -96.7970), (33.7490, -84.3880)],
    }

    payload = {
        "current": {"label": "Chicago, IL", "lat": 41.8781, "lng": -87.6298},
        "pickup": {"label": "Dallas, TX", "lat": 32.7767, "lng": -96.7970},
        "dropoff": {"label": "Atlanta, GA", "lat": 33.7490, "lng": -84.3880},
        "cycle_used_hrs": 30.0,
        "start_datetime": "2026-10-12T07:00:00",
    }

    with patch("planner.views.get_two_leg_route", return_value=mock_route_result):
        response = client.post("/api/plan-trip/", data=payload, format="json")

    assert response.status_code == 200
    data = response.json()
    stops = data["stops"]

    # Verify stops count is exactly 7
    assert len(stops) == 7

    # Verify stop types in order: break, rest, pickup, fuel, rest, break, dropoff
    stop_types = [s["type"] for s in stops]
    assert stop_types == ["break", "rest", "pickup", "fuel", "rest", "break", "dropoff"]

    # Each rest stop has duration_hrs = 10.0 (not split into 5.5 and 4.5)
    rest_stops = [s for s in stops if s["type"] == "rest"]
    assert len(rest_stops) == 2
    for r in rest_stops:
        assert r["duration_hrs"] == 10.0


def test_missing_start_datetime_rounds_up_to_15_minutes(client):
    """
    When start_datetime is missing, it defaults to now in origin timezone,
    rounded UP to the next 15-minute mark.
    """
    mock_route_result = {
        "geojson": {"type": "Feature", "geometry": {"type": "LineString", "coordinates": []}},
        "total_miles": 100.0,
        "total_drive_hours": 2.0,
        "legs": [
            {
                "name": "Current to Pickup",
                "distance_miles": 50.0,
                "duration_hours": 1.0,
                "start_coords": (41.8781, -87.6298),
                "end_coords": (41.8000, -87.6000),
            },
            {
                "name": "Pickup to Dropoff",
                "distance_miles": 50.0,
                "duration_hours": 1.0,
                "start_coords": (41.8000, -87.6000),
                "end_coords": (41.7000, -87.5000),
            },
        ],
        "all_coordinates": [(41.8781, -87.6298), (41.7000, -87.5000)],
    }

    payload = {
        "current": {"label": "Chicago, IL", "lat": 41.8781, "lng": -87.6298},
        "pickup": {"label": "Facility 1", "lat": 41.8000, "lng": -87.6000},
        "dropoff": {"label": "Facility 2", "lat": 41.7000, "lng": -87.5000},
        "cycle_used_hrs": 10.0,
        # start_datetime is omitted
    }

    with patch("planner.views.get_two_leg_route", return_value=mock_route_result):
        response = client.post("/api/plan-trip/", data=payload, format="json")

    assert response.status_code == 200
    data = response.json()
    first_stop = data["stops"][0]
    # First stop eta_start minute must be on a 15-minute boundary (0, 15, 30, 45)
    # or driving started at a 15-minute boundary
    day1_segs = data["daily_logs"][0]["segments"]
    # Driving segment starts at the rounded start_time
    driving_seg = next(s for s in day1_segs if s["status"] == "DRIVING")
    from datetime import datetime
    dt_start = datetime.fromisoformat(driving_seg["start"])
    assert dt_start.minute % 15 == 0
    assert dt_start.second == 0


def test_reverse_geocode_success_and_cache_hit():
    """reverse_geocode_location returns City, ST and hits cache on second call."""
    from planner.services import reverse_geocode_location

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "address": {"city": "Memphis", "state_code": "TN", "country": "United States"}
    }

    with patch("requests.get", return_value=mock_resp) as mock_get:
        # First call: hits upstream
        res1 = reverse_geocode_location(35.1495, -90.0490)
        assert res1 == "Memphis, TN"
        assert mock_get.call_count == 1

        # Second call: served from Django cache
        res2 = reverse_geocode_location(35.1495, -90.0490)
        assert res2 == "Memphis, TN"
        assert mock_get.call_count == 1


def test_reverse_geocode_timeout_fallback(client):
    """When reverse geocode times out or fails, stop label falls back to Mile N cleanly."""
    from planner.services import reverse_geocode_location

    with patch("requests.get", side_effect=Exception("ReadTimeout")):
        res = reverse_geocode_location(35.0, -90.0, timeout=0.1)
        assert res is None  # Fails gracefully without throwing


def test_from_and_to_fields_in_daily_logs(client):
    """Verify that daily logs contain from_city and to_city header fields."""
    mock_route_result = {
        "geojson": {"type": "Feature", "geometry": {"type": "LineString", "coordinates": []}},
        "total_miles": 1749.61,
        "total_drive_hours": 31.25,
        "legs": [
            {
                "name": "Current to Pickup",
                "distance_miles": 966.9,
                "duration_hours": 17.1,
                "start_coords": (41.8781, -87.6298),
                "end_coords": (32.7767, -96.7970),
            },
            {
                "name": "Pickup to Dropoff",
                "distance_miles": 782.71,
                "duration_hours": 14.15,
                "start_coords": (32.7767, -96.7970),
                "end_coords": (33.7490, -84.3880),
            },
        ],
        "all_coordinates": [(41.8781, -87.6298), (32.7767, -96.7970), (33.7490, -84.3880)],
    }

    payload = {
        "current": {"label": "Chicago, IL", "lat": 41.8781, "lng": -87.6298},
        "pickup": {"label": "Dallas, TX", "lat": 32.7767, "lng": -96.7970},
        "dropoff": {"label": "Atlanta, GA", "lat": 33.7490, "lng": -84.3880},
        "cycle_used_hrs": 30.0,
        "start_datetime": "2026-10-12T07:00:00",
    }

    with patch("planner.views.get_two_leg_route", return_value=mock_route_result):
        response = client.post("/api/plan-trip/", data=payload, format="json")

    assert response.status_code == 200
    data = response.json()
    day1 = data["daily_logs"][0]
    assert "from_city" in day1
    assert "to_city" in day1
    assert "Chicago" in day1["from_city"]



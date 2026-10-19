"""
services.py - Routing, Geocoding, Geometry Interpolation, and Timezone Services.
Supports:
1. Nominatim geocoding with user-agent, rate limiting, and caching.
2. Unified Routing Interface: OSRM public server by default, OpenRouteService if ORS_API_KEY is set.
3. Polyline distance interpolation for exact stop lat/lng.
4. Timezone lookup from origin coordinates via timezonefinder.
"""

from __future__ import annotations
import os
import math
import time
import json
import logging
from typing import List, Dict, Any, Tuple, Optional
from datetime import datetime
from zoneinfo import ZoneInfo

import requests
from django.core.cache import cache
from timezonefinder import TimezoneFinder

logger = logging.getLogger(__name__)

# Initialize single timezonefinder instance
_tz_finder = TimezoneFinder()

# Constants
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_USER_AGENT = os.environ.get("NOMINATIM_USER_AGENT", "ELDTripPlannerAssessment/1.0 (contact: student@assessment.local)")

OSRM_ROUTE_URL = os.environ.get("OSRM_ROUTE_URL", "https://router.project-osrm.org/route/v1/driving")
ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/driving-car/geojson"

# Rate limit timestamp tracker for Nominatim (1 request / second requirement)
_last_nominatim_call = 0.0


def geocode_address(query: str, limit: int = 5) -> List[Dict[str, Any]]:
    """
    Search Nominatim for matching addresses/cities.
    Caches results and strictly obeys rate limits.
    Returns: list of { "label": str, "lat": float, "lng": float }
    """
    query = (query or "").strip()
    if not query:
        return []

    cache_key = f"geocode_{query.lower()}_{limit}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    global _last_nominatim_call
    now = time.time()
    elapsed = now - _last_nominatim_call
    if elapsed < 1.05:
        time.sleep(1.05 - elapsed)
    _last_nominatim_call = time.time()

    headers = {"User-Agent": NOMINATIM_USER_AGENT}
    params = {
        "q": query,
        "format": "jsonv2",
        "limit": limit,
        "addressdetails": 1,
    }

    try:
        resp = requests.get(NOMINATIM_URL, params=params, headers=headers, timeout=8)
        resp.raise_for_status()
        data = resp.json()
        results = []
        for item in data:
            results.append({
                "label": item.get("display_name", query),
                "lat": float(item["lat"]),
                "lng": float(item["lon"]),
            })
        if results:
            # Cache for 24 hours
            cache.set(cache_key, results, 86400)
            return results
    except Exception as exc:
        logger.warning(f"Nominatim geocode failed for query '{query}': {exc}")

    # Fallback provider: Photon (Komoot OSM search API)
    try:
        photon_url = "https://photon.komoot.io/api/"
        p_resp = requests.get(
            photon_url,
            params={"q": query, "limit": limit},
            headers={"User-Agent": NOMINATIM_USER_AGENT},
            timeout=8,
        )
        p_resp.raise_for_status()
        p_data = p_resp.json()
        results = []
        for feat in p_data.get("features", []):
            coords = feat.get("geometry", {}).get("coordinates", [])
            props = feat.get("properties", {})
            if len(coords) >= 2:
                parts = [
                    props.get("name"),
                    props.get("city"),
                    props.get("county"),
                    props.get("state"),
                    props.get("country"),
                ]
                label_parts = [p for p in parts if p]
                # Remove consecutive duplicates
                clean_parts = []
                for p in label_parts:
                    if not clean_parts or clean_parts[-1] != p:
                        clean_parts.append(p)
                label = ", ".join(clean_parts) if clean_parts else query
                results.append({
                    "label": label,
                    "lat": float(coords[1]),
                    "lng": float(coords[0]),
                })
        if results:
            cache.set(cache_key, results, 86400)
            return results
    except Exception as p_exc:
        logger.warning(f"Photon fallback geocode failed for query '{query}': {p_exc}")

    return []


NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"



def reverse_geocode_location(lat: float, lng: float, timeout: float = 2.5) -> Optional[str]:
    """
    Reverse-geocodes (lat, lng) to 'City, ST' via Nominatim reverse (zoom ~10).
    Cached for 7 days. Respects 1 req/sec rate limit.
    Returns: 'City, ST' string or None on failure.
    """
    lat_r = round(lat, 3)
    lng_r = round(lng, 3)
    cache_key = f"rev_geo_{lat_r}_{lng_r}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    global _last_nominatim_call
    now = time.time()
    elapsed = now - _last_nominatim_call
    if elapsed < 1.05:
        time.sleep(1.05 - elapsed)
    _last_nominatim_call = time.time()

    headers = {"User-Agent": NOMINATIM_USER_AGENT}
    params = {
        "lat": lat,
        "lon": lng,
        "format": "jsonv2",
        "zoom": 12,
        "addressdetails": 1,
    }

    try:
        resp = requests.get(NOMINATIM_REVERSE_URL, params=params, headers=headers, timeout=timeout)
        if resp.status_code == 200:
            data = resp.json()
            address = data.get("address", {})
            city = (
                address.get("city")
                or address.get("town")
                or address.get("village")
                or address.get("municipality")
                or address.get("hamlet")
                or address.get("suburb")
                or ""
            )
            if not city and address.get("county"):
                city = address["county"].replace(" County", " Co.")
            iso = address.get("ISO3166-2-lvl4") or ""
            label_st = iso.split("-")[-1] if iso.startswith("US-") else (address.get("state_code") or address.get("state") or "")
            if city and label_st:
                result = f"{city}, {label_st}"
            elif city:
                result = city
            elif label_st:
                result = label_st
            else:
                result = data.get("name") or None

            if result:
                cache.set(cache_key, result, 86400 * 7)
            return result
    except Exception as exc:
        logger.warning(f"Reverse geocode failed for ({lat}, {lng}): {exc}")

    return None



def resolve_timezone(lat: float, lng: float) -> str:
    """Resolve origin timezone using timezonefinder with UTC fallback."""
    try:
        tz_name = _tz_finder.timezone_at(lat=lat, lng=lng)
        if tz_name:
            return tz_name
    except Exception as exc:
        logger.warning(f"Timezone resolution failed for ({lat}, {lng}): {exc}")
    return "UTC"


def haversine_distance_miles(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
    """Distance in miles between two (lat, lng) tuples."""
    lat1, lon1 = p1
    lat2, lon2 = p2
    r = 3958.8  # Earth radius in miles
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def interpolate_along_polyline(
    coordinates: List[Tuple[float, float]],
    target_mile: float
) -> Tuple[float, float]:
    """
    Given a list of [lat, lng] coordinates representing a route polyline,
    finds the exact (lat, lng) at `target_mile` cumulative distance along the polyline.
    If target_mile <= 0, returns the first point.
    If target_mile >= total length, returns the last point.
    """
    if not coordinates:
        return (0.0, 0.0)
    if len(coordinates) == 1 or target_mile <= 0:
        return coordinates[0]

    accumulated = 0.0
    for i in range(len(coordinates) - 1):
        p1 = coordinates[i]
        p2 = coordinates[i + 1]
        seg_dist = haversine_distance_miles(p1, p2)

        if accumulated + seg_dist >= target_mile:
            # Interpolate within this segment
            remaining = target_mile - accumulated
            fraction = (remaining / seg_dist) if seg_dist > 1e-6 else 0.0
            lat = p1[0] + fraction * (p2[0] - p1[0])
            lng = p1[1] + fraction * (p2[1] - p1[1])
            return (lat, lng)



        accumulated += seg_dist

    return coordinates[-1]


def simplify_geometry(coords: List[List[float]], target_max_points: int = 1500) -> List[List[float]]:
    """
    Downsamples or simplifies coordinates to at most ~target_max_points while
    strictly preserving endpoints.
    coords is list of [lng, lat].
    """
    n = len(coords)
    if n <= target_max_points:
        return coords

    step = math.ceil(n / target_max_points)
    simplified = [coords[0]]
    for i in range(step, n - 1, step):
        simplified.append(coords[i])
    simplified.append(coords[-1])
    return simplified




def get_two_leg_route(
    current: Dict[str, Any],
    pickup: Dict[str, Any],
    dropoff: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Unified Routing Interface.
    Fetches route for current -> pickup -> dropoff in one request.
    Uses ORS if ORS_API_KEY is present, otherwise public OSRM.
    Returns:
    {
        "geojson": GeoJSON FeatureCollection / LineString,
        "total_miles": float,
        "total_drive_hours": float,
        "legs": [
            {
                "distance_miles": float,
                "duration_hours": float,
                "start_coords": [lat, lng],
                "end_coords": [lat, lng],
                "coordinates": [[lat, lng], ...]
            },
            ...
        ],
        "all_coordinates": [[lat, lng], ...]
    }
    """
    cache_key = (
        f"route_{current['lat']:.4f}_{current['lng']:.4f}_"
        f"{pickup['lat']:.4f}_{pickup['lng']:.4f}_"
        f"{dropoff['lat']:.4f}_{dropoff['lng']:.4f}"
    )
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    ors_key = os.environ.get("ORS_API_KEY")
    if ors_key:
        result = _fetch_route_ors(current, pickup, dropoff, ors_key)
    else:
        result = _fetch_route_osrm(current, pickup, dropoff)

    # Cache route for 12 hours
    cache.set(cache_key, result, 43200)
    return result


def _fetch_route_osrm(
    current: Dict[str, Any],
    pickup: Dict[str, Any],
    dropoff: Dict[str, Any]
) -> Dict[str, Any]:
    """Fetch 2-leg route via public OSRM server with retry & clear error messages."""
    # OSRM coordinates are formatted as {longitude},{latitude};{longitude},{latitude}...
    coords_str = (
        f"{current['lng']},{current['lat']};"
        f"{pickup['lng']},{pickup['lat']};"
        f"{dropoff['lng']},{dropoff['lat']}"
    )
    url = f"{OSRM_ROUTE_URL}/{coords_str}?overview=full&geometries=geojson&steps=false"

    last_err = None
    for attempt in range(2):
        try:
            resp = requests.get(url, timeout=12)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("code") != "Ok" or not data.get("routes"):
                    raise ValueError(f"OSRM returned error code: {data.get('code')}")

                route = data["routes"][0]
                legs_data = route.get("legs", [])
                if len(legs_data) < 2:
                    raise ValueError("OSRM did not return 2 legs for the 3 waypoints.")

                # OSRM geometry is [lng, lat]
                raw_coords = route["geometry"]["coordinates"]
                all_coords = [(pt[1], pt[0]) for pt in raw_coords]  # converted to [lat, lng]

                # Convert meters to miles (1 m = 0.000621371 mi), seconds to hours
                leg1_miles = legs_data[0]["distance"] * 0.000621371
                leg1_hours = legs_data[0]["duration"] / 3600.0

                leg2_miles = legs_data[1]["distance"] * 0.000621371
                leg2_hours = legs_data[1]["duration"] / 3600.0

                total_miles = route["distance"] * 0.000621371
                total_hours = route["duration"] / 3600.0

                # Form GeoJSON with simplified geometry (~1000-2000 points)
                simplified_coords = simplify_geometry(raw_coords, target_max_points=1500)
                geojson = {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": simplified_coords,  # GeoJSON standard is [lng, lat]
                    },
                    "properties": {
                        "total_miles": round(total_miles, 2),
                        "total_duration_hours": round(total_hours, 2),
                    }
                }


                return {
                    "geojson": geojson,
                    "total_miles": round(total_miles, 2),
                    "total_drive_hours": round(total_hours, 2),
                    "legs": [
                        {
                            "name": "Current to Pickup",
                            "distance_miles": round(leg1_miles, 2),
                            "duration_hours": round(leg1_hours, 2),
                            "start_coords": (current["lat"], current["lng"]),
                            "end_coords": (pickup["lat"], pickup["lng"]),
                        },
                        {
                            "name": "Pickup to Dropoff",
                            "distance_miles": round(leg2_miles, 2),
                            "duration_hours": round(leg2_hours, 2),
                            "start_coords": (pickup["lat"], pickup["lng"]),
                            "end_coords": (dropoff["lat"], dropoff["lng"]),
                        },
                    ],
                    "all_coordinates": all_coords,
                }
            else:
                last_err = f"OSRM server returned HTTP {resp.status_code}: {resp.text}"
        except Exception as exc:
            last_err = str(exc)
        time.sleep(1.0)

    raise ConnectionError(f"Failed to fetch route from OSRM after 2 attempts: {last_err}")


def _fetch_route_ors(
    current: Dict[str, Any],
    pickup: Dict[str, Any],
    dropoff: Dict[str, Any],
    api_key: str
) -> Dict[str, Any]:
    """Fetch 2-leg route via OpenRouteService API with retry & clear error messages."""
    headers = {
        "Authorization": api_key,
        "Content-Type": "application/json",
    }
    body = {
        "coordinates": [
            [current["lng"], current["lat"]],
            [pickup["lng"], pickup["lat"]],
            [dropoff["lng"], dropoff["lat"]],
        ]
    }

    last_err = None
    for attempt in range(2):
        try:
            resp = requests.post(ORS_DIRECTIONS_URL, json=body, headers=headers, timeout=12)
            if resp.status_code == 200:
                data = resp.json()
                feature = data["features"][0]
                summary = feature["properties"]["summary"]
                segments = feature["properties"]["segments"]

                raw_coords = feature["geometry"]["coordinates"]
                all_coords = [(pt[1], pt[0]) for pt in raw_coords]

                leg1_miles = segments[0]["distance"] * 0.000621371
                leg1_hours = segments[0]["duration"] / 3600.0

                leg2_miles = segments[1]["distance"] * 0.000621371
                leg2_hours = segments[1]["duration"] / 3600.0

                total_miles = summary["distance"] * 0.000621371
                total_hours = summary["duration"] / 3600.0

                simplified_coords = simplify_geometry(raw_coords, target_max_points=1500)
                feature["geometry"]["coordinates"] = simplified_coords

                return {
                    "geojson": feature,

                    "total_miles": round(total_miles, 2),
                    "total_drive_hours": round(total_hours, 2),
                    "legs": [
                        {
                            "name": "Current to Pickup",
                            "distance_miles": round(leg1_miles, 2),
                            "duration_hours": round(leg1_hours, 2),
                            "start_coords": (current["lat"], current["lng"]),
                            "end_coords": (pickup["lat"], pickup["lng"]),
                        },
                        {
                            "name": "Pickup to Dropoff",
                            "distance_miles": round(leg2_miles, 2),
                            "duration_hours": round(leg2_hours, 2),
                            "start_coords": (pickup["lat"], pickup["lng"]),
                            "end_coords": (dropoff["lat"], dropoff["lng"]),
                        },
                    ],
                    "all_coordinates": all_coords,
                }
            else:
                last_err = f"OpenRouteService returned HTTP {resp.status_code}: {resp.text}"
        except Exception as exc:
            last_err = str(exc)
        time.sleep(1.0)

    raise ConnectionError(f"Failed to fetch route from OpenRouteService after 2 attempts: {last_err}")

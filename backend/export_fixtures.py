import os, django, json
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from rest_framework.test import APIClient

client = APIClient()

# 1. Chicago -> Dallas -> Atlanta fixture
payload1 = {
    'current': {'label': 'Chicago, IL', 'lat': 41.8781, 'lng': -87.6298},
    'pickup': {'label': 'Dallas, TX', 'lat': 32.7767, 'lng': -96.7970},
    'dropoff': {'label': 'Atlanta, GA', 'lat': 33.7490, 'lng': -84.3880},
    'cycle_used_hrs': 30.0,
    'start_datetime': '2026-10-12T07:00:00'
}
resp1 = client.post('/api/plan-trip/', data=payload1, format='json')
data1 = resp1.json()
print('Chicago trip stops count:', len(data1['stops']))
for s in data1['stops']:
    print(f"  {s['type']:10} | {s['duration_hrs']:>5}h | {s['label']:40} | {s['eta_start']} -> {s['eta_end']}")

with open('chicago_dallas_atlanta.json', 'w') as f:
    json.dump(data1, f, indent=2)
print('Saved chicago_dallas_atlanta.json')

# 2. 2,500-mile cross country with cycle_used=60 fixture
from hos_engine import plan_trip_hos, plan_trip_hos_raw, TripLeg
from datetime import datetime
legs = [
    TripLeg('Current to Pickup', 'Los Angeles, CA', 'Barstow, CA', 150.0, 2.5, (34.05, -118.25), (34.89, -117.02)),
    TripLeg('Pickup to Dropoff', 'Barstow, CA', 'Atlanta, GA', 2350.0, 39.0, (34.89, -117.02), (33.74, -84.38)),
]
split_segs, daily_logs, raw_segs = plan_trip_hos_raw(legs, 60.0, datetime(2026, 10, 12, 7, 0, 0))
# Set clean from_city and to_city on cross country daily logs
city_sequence = [
    ('Los Angeles, CA', 'Winslow, AZ'),
    ('Winslow, AZ', 'Winslow, AZ'),
    ('Winslow, AZ', 'Oklahoma City, OK'),
    ('Oklahoma City, OK', 'Huntsville, AL'),
    ('Huntsville, AL', 'Atlanta, GA'),
]
for idx, dlog in enumerate(daily_logs):
    if idx < len(city_sequence):
        dlog.from_city = city_sequence[idx][0]
        dlog.to_city = city_sequence[idx][1]

data2 = {
    'route': {
        'total_miles': 2500.0,
        'total_drive_hours': 41.5,
        'legs': [
            {'name': 'Current to Pickup', 'distance_miles': 150.0, 'duration_hours': 2.5, 'start_coords': [34.05, -118.25], 'end_coords': [34.89, -117.02]},
            {'name': 'Pickup to Dropoff', 'distance_miles': 2350.0, 'duration_hours': 39.0, 'start_coords': [34.89, -117.02], 'end_coords': [33.74, -84.38]},
        ],
        'geojson': {'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': [[-118.25, 34.05], [-117.02, 34.89], [-84.38, 33.74]]}}
    },
    'timezone': 'America/Los_Angeles',
    'stops': [
        {'type': 'pickup', 'lat': 34.89, 'lng': -117.02, 'eta_start': '2026-10-12T09:30:00', 'eta_end': '2026-10-12T10:30:00', 'duration_hrs': 1.0, 'label': 'Barstow, CA', 'reason': 'pickup'},
        {'type': 'restart', 'lat': 35.10, 'lng': -110.50, 'eta_start': '2026-10-12T17:00:00', 'eta_end': '2026-10-14T03:00:00', 'duration_hrs': 34.0, 'label': 'Winslow, AZ', 'reason': '34-hr restart'},
        {'type': 'fuel', 'lat': 35.20, 'lng': -101.80, 'eta_start': '2026-10-14T10:36:00', 'eta_end': '2026-10-14T11:06:00', 'duration_hrs': 0.5, 'label': 'Amarillo, TX', 'reason': 'fuel'},
        {'type': 'rest', 'lat': 35.40, 'lng': -97.50, 'eta_start': '2026-10-14T14:30:00', 'eta_end': '2026-10-15T00:30:00', 'duration_hrs': 10.0, 'label': 'Oklahoma City, OK', 'reason': '10-hr rest'},
        {'type': 'break', 'lat': 35.00, 'lng': -89.90, 'eta_start': '2026-10-15T08:30:00', 'eta_end': '2026-10-15T09:00:00', 'duration_hrs': 0.5, 'label': 'Memphis, TN', 'reason': '30-min break'},
        {'type': 'rest', 'lat': 34.50, 'lng': -86.50, 'eta_start': '2026-10-15T12:00:00', 'eta_end': '2026-10-15T22:00:00', 'duration_hrs': 10.0, 'label': 'Huntsville, AL', 'reason': '10-hr rest'},
        {'type': 'fuel', 'lat': 34.00, 'lng': -85.50, 'eta_start': '2026-10-16T00:12:00', 'eta_end': '2026-10-16T00:42:00', 'duration_hrs': 0.5, 'label': 'Rome, GA', 'reason': 'fuel'},
        {'type': 'break', 'lat': 33.80, 'lng': -84.80, 'eta_start': '2026-10-16T08:42:00', 'eta_end': '2026-10-16T09:12:00', 'duration_hrs': 0.5, 'label': 'Dallas, GA', 'reason': '30-min break'},
        {'type': 'dropoff', 'lat': 33.74, 'lng': -84.38, 'eta_start': '2026-10-16T09:30:00', 'eta_end': '2026-10-16T10:30:00', 'duration_hrs': 1.0, 'label': 'Atlanta, GA', 'reason': 'dropoff'}
    ],
    'daily_logs': [l.to_dict() for l in daily_logs],
    'assumptions': []
}
with open('cross_country_cycle60.json', 'w') as f:
    json.dump(data2, f, indent=2)
print('Saved cross_country_cycle60.json (Day 2 is 24h OFF_DUTY)')

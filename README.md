# ELD Trip Planner

A full-stack FMCSA-compliant ELD (Electronic Logging Device) trip planner built with Django + React. Enter a current location, pickup, and dropoff; get a routed map, HOS-compliant stop schedule, and printable Driver's Daily Log sheets.

---

## Live Demo

| Service | URL |
|---------|-----|
| Frontend | `https://eld-trip-planner-xi-sable.vercel.app` |
| API | `https://eld-trip-planner-api-gumw.onrender.com` |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Browser (React + Vite)                                  │
│  • TripForm ──→ POST /api/plan-trip/                     │
│  • MapView (Leaflet + OSM tiles)                         │
│  • StopsTimeline                                         │
│  • LogViewer → LogSheet (pure SVG, print/PDF)            │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTPS / JSON
┌──────────────────────────▼──────────────────────────────┐
│  Django REST API (Render / Gunicorn + WhiteNoise)        │
│  • GET  /api/geocode/?q=      Nominatim autocomplete     │
│  • POST /api/plan-trip/       Route + HOS + logs         │
│    ├─ planner/services.py     Geocoding, routing cache   │
│    ├─ hos_engine.py           Pure-Python HOS engine     │
│    └─ timezonefinder          Origin TZ resolution       │
└─────────────────────────────────────────────────────────┘
         │ Nominatim API (geocoding)
         │ OSRM public API  (routing, default)
         │ OpenRouteService (routing, when ORS_API_KEY set)
```

---

## Local Setup

### Prerequisites

- Python ≥ 3.12 (project pins 3.12.8 via `.python-version`)
- Node.js ≥ 20

### 1 — Clone

```bash
git clone https://github.com/osaidzagha/eld-trip-planner.git
cd eld-trip-planner
```

### 2 — Backend

```bash
cd backend

# Create and activate virtualenv
python -m venv venv
# Windows:
.\venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt

# Run migrations (SQLite, only needed for Django admin)
python manage.py migrate

# Start dev server
python manage.py runserver 127.0.0.1:8000
```

Optional environment variables (create `backend/.env` or export):

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | insecure dev key | Django secret key — **change in production** |
| `DEBUG` | `True` | Set `False` in production |
| `ALLOWED_HOSTS` | `*` | Comma-separated hosts |
| `CORS_ALLOW_ALL_ORIGINS` | `True` | Set `False` and use `CORS_ALLOWED_ORIGINS` in production |
| `CORS_ALLOWED_ORIGINS` | _(unset)_ | Comma-separated allowed origins (e.g. Vercel URL) |
| `CSRF_TRUSTED_ORIGINS` | _(unset)_ | Same as `CORS_ALLOWED_ORIGINS` for cookie safety |
| `ORS_API_KEY` | _(unset)_ | OpenRouteService key; falls back to public OSRM when absent |
| `OSRM_URL` | `https://router.project-osrm.org` | Custom OSRM endpoint |

### 3 — Frontend

```bash
cd frontend
npm install
npm run dev          # → http://127.0.0.1:5173
```

The Vite dev server proxies `/api` → `http://127.0.0.1:8000` automatically.

---

## Running Tests

### Backend (pytest)

```bash
cd backend
.\venv\Scripts\pytest -v       # Windows
# or
pytest -v                       # after activating venv
```

**21 tests — all must pass:**

| File | Tests | Coverage |
|------|-------|----------|
| `test_hos_engine.py` | 9 | HOS rules, midnight split, fuel stops, cycle restart |
| `test_api.py` | 12 | Validation, routing mock, stop extraction, rev-geocode |

### Frontend (Vitest)

```bash
cd frontend
npx vitest run
```

**13 tests** in `src/utils/logGridGeometry.test.js` covering grid geometry, duty path, remarks, fixture invariants.

---

## API Reference

### `GET /api/geocode/?q=<query>`

Nominatim-backed address autocomplete. Returns up to 5 candidates.

**Response** `200 OK`:
```json
[
  { "label": "Chicago, Illinois, United States", "lat": 41.8781, "lng": -87.6298 },
  ...
]
```

---

### `POST /api/plan-trip/`

Plans a complete ELD trip: routing → HOS simulation → stop schedule → daily log sheets.

**Request body:**
```json
{
  "current":  { "label": "Chicago, IL",  "lat": 41.8781, "lng": -87.6298 },
  "pickup":   { "label": "Dallas, TX",   "lat": 32.7767, "lng": -96.7970 },
  "dropoff":  { "label": "Atlanta, GA",  "lat": 33.7490, "lng": -84.3880 },
  "cycle_used_hrs": 30,
  "start_datetime": "2024-11-15T08:00:00"   // Optional; ISO 8601. Defaults to now rounded up 15 min.
}
```

All three location objects require `lat` and `lng`; `label` is optional but displayed in the UI.  
`cycle_used_hrs` must be between `0` and `70` (inclusive).

**Response** `200 OK`:
```json
{
  "route": {
    "geojson": { "type": "LineString", "coordinates": [[lng, lat], ...] },
    "total_miles": 967.4,
    "total_drive_hours": 14.2,
    "legs": [
      {
        "name": "Current to Pickup",
        "distance_miles": 921.0,
        "duration_hours": 13.5,
        "start_coords": [41.878, -87.63],
        "end_coords": [32.777, -96.797]
      },
      { ... }
    ]
  },
  "stops": [
    {
      "type": "break|fuel|rest|restart|pickup|dropoff",
      "lat": 37.12,
      "lng": -94.34,
      "eta_start": "2024-11-15T16:00:00",
      "eta_end": "2024-11-15T16:30:00",
      "duration_hrs": 0.5,
      "label": "Joplin, MO",
      "reason": "30-min break"
    }
  ],
  "daily_logs": [
    {
      "date": "2024-11-15",
      "from_city": "Chicago, IL",
      "to_city": "Joplin, MO",
      "total_miles_driving": 921.0,
      "total_hours": { "OFF_DUTY": 8.0, "SLEEPER": 0.0, "DRIVING": 11.0, "ON_DUTY_NOT_DRIVING": 5.0 },
      "segments": [
        {
          "status": "DRIVING",
          "start": "2024-11-15T08:00:00",
          "end": "2024-11-15T19:00:00",
          "location_label": "En route Chicago, IL to Dallas, TX",
          "miles": 640.0,
          "reason": "driving"
        }
      ]
    }
  ],
  "timezone": "America/Chicago",
  "assumptions": [ "..." ]
}
```

**Error responses:**

| Code | When |
|------|------|
| `400` | Validation failure — body contains `{ "errors": { "field": "message" } }` |
| `502` | Routing service unreachable |

---

## HOS Logic (Engine Assumptions)

The engine (`backend/hos_engine.py`) is a pure Python state machine. It receives naive datetimes already in the origin's home-terminal timezone and knows nothing about Django or HTTP.

### Rules implemented (70 hr / 8-day property-carrying cycle)

| Rule | Limit | Reset condition |
|------|-------|-----------------|
| **11-hour driving limit** | 11 h driving per shift | 10 consecutive hours off duty (SLEEPER) |
| **14-hour duty window** | 14 h wall-clock from first on-duty | 10 consecutive hours off duty (SLEEPER). **Never pauses** for breaks |
| **30-minute break** | Required after 8 cumulative driving hours | Any 30+ consecutive minutes of non-driving (fuel stops, pickup/dropoff all qualify) |
| **70-hour cycle** | Cumulative on-duty hours ≤ 70 in a rolling 8-day window | 34 consecutive hours off duty (OFF_DUTY) |

### Status codes

| Status | Description |
|--------|-------------|
| `DRIVING` | Behind the wheel |
| `ON_DUTY_NOT_DRIVING` | Pickup, dropoff, fuel stop |
| `SLEEPER` | 10-hour mandatory rest |
| `OFF_DUTY` | 34-hour cycle restart |

### Conservative simplifications (documented by design)

1. **No hours roll off during the trip.** `cycle_used_hrs` accumulates monotonically; past days' hours never expire mid-trip. This is conservative — the real 8-day rolling window would allow more driving.
2. **Fresh shift at trip start.** The 11-hour and 14-hour clocks begin at the trip's first second. The driver is assumed to have had 10+ hours off before departure.
3. **Fuel at 1,000-mile intervals.** Inserted as 30 minutes `ON_DUTY_NOT_DRIVING` whenever cumulative miles since the last fuel stop (or trip start) crosses 1,000 miles.

### Trip order

```
Current Location
  └─ DRIVING ─→ Pickup (1 hr ON_DUTY_NOT_DRIVING)
                  └─ DRIVING ─→ Dropoff (1 hr ON_DUTY_NOT_DRIVING)
```

### Midnight splitting

Every event is split at midnight in the **origin's home-terminal timezone** (resolved via `timezonefinder`; falls back to UTC). Each day's four duty-status totals must sum to exactly **24.00 hours**, with any unused time padded as `OFF_DUTY`.

---

## Deployment

### Backend → Render

1. Push repo to GitHub.
2. On Render, click **New → Blueprint** and point to this repo — Render reads `render.yaml` automatically.
3. After the first deploy, note the service URL (e.g. `https://eld-trip-planner-api.onrender.com`).
4. In the Render dashboard set:
   - `CORS_ALLOWED_ORIGINS` = your Vercel URL
   - `CSRF_TRUSTED_ORIGINS` = same value

### Frontend → Vercel

1. In your Vercel project settings, add the environment variable `VITE_API_URL` set to the Render service URL (no trailing slash) before the first build.
2. On Vercel, **Add New Project** → import the GitHub repo.
3. Set **Root Directory** to `frontend`.
4. Build command: `npm run build`; Output directory: `dist`.
5. Deploy.

### Environment variable checklist

| Platform | Variable | Required |
|----------|----------|----------|
| Render | `SECRET_KEY` | Auto-generated by blueprint |
| Render | `DEBUG` | Set to `False` |
| Render | `ALLOWED_HOSTS` | `.onrender.com` |
| Render | `CORS_ALLOWED_ORIGINS` | Your Vercel URL |
| Render | `CSRF_TRUSTED_ORIGINS` | Your Vercel URL |
| Render | `ORS_API_KEY` | Optional; enables ORS routing |
| Vercel | _(none)_ | All config in `vercel.json` |

---

## Project Structure

```
eld-trip-planner/
├── backend/
│   ├── config/
│   │   ├── settings.py        # Django settings (env-var driven)
│   │   ├── urls.py            # Root URL conf
│   │   └── wsgi.py
│   ├── planner/
│   │   ├── views.py           # GeocodeView, PlanTripView
│   │   └── services.py        # Nominatim, OSRM/ORS, reverse-geocode, cache
│   ├── hos_engine.py          # Pure-Python HOS state machine
│   ├── test_hos_engine.py     # 9 pytest tests
│   ├── test_api.py            # 12 pytest tests
│   ├── requirements.txt
│   ├── Dockerfile
│   └── pytest.ini
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # Two-tab shell
│   │   ├── components/
│   │   │   ├── TripForm.jsx       # Form with autocomplete + presets
│   │   │   ├── LocationInput.jsx  # Debounced geocode search
│   │   │   ├── MapView.jsx        # Leaflet map + markers
│   │   │   ├── StopsTimeline.jsx  # Stop list with map sync
│   │   │   ├── SummaryCards.jsx   # Top-line metrics
│   │   │   ├── LogSheet.jsx       # FMCSA SVG daily log
│   │   │   ├── LogViewer.jsx      # Multi-day tabs + PDF export
│   │   │   └── AssumptionsPanel.jsx
│   │   └── utils/
│   │       ├── logGridGeometry.js      # SVG math + path generation
│   │       └── logGridGeometry.test.js # 13 Vitest tests
│   ├── vercel.json
│   └── vite.config.js
├── render.yaml
├── .python-version            # 3.12.8
├── .gitignore
└── README.md
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend framework | Django 6.1 + Django REST Framework |
| WSGI server | Gunicorn |
| Static files | WhiteNoise |
| Geocoding | Nominatim (OSM) — 1 req/s, in-memory cache |
| Routing | OSRM (public) or OpenRouteService (when key set) |
| Timezone resolution | `timezonefinder` |
| Frontend framework | React 19 + Vite 8 |
| Styling | Tailwind CSS v4 |
| Map | Leaflet + react-leaflet |
| Log sheet | Pure SVG (responsive, print-ready) |
| PDF export | jsPDF + html2canvas |
| Frontend tests | Vitest 5 |
| Backend tests | pytest + pytest-django |
| CI/CD | Render Blueprint + Vercel GitHub integration |

---

## License

MIT

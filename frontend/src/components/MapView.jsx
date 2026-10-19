import React, { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Vite Leaflet marker icon asset issue by creating custom clean SVG markers
const createCustomIcon = (type, number) => {
  let bgColor = '#3B82F6'; // blue default
  let borderColor = '#1D4ED8';
  let label = number || '';

  switch (type) {
    case 'origin':
      bgColor = '#10B981'; // emerald green
      borderColor = '#047857';
      label = 'A';
      break;
    case 'pickup':
      bgColor = '#8B5CF6'; // purple
      borderColor = '#6D28D9';
      label = 'P';
      break;
    case 'dropoff':
      bgColor = '#EF4444'; // red
      borderColor = '#B91C1C';
      label = 'D';
      break;
    case 'fuel':
      bgColor = '#F59E0B'; // amber
      borderColor = '#B45309';
      label = '⛽';
      break;
    case 'break':
      bgColor = '#06B6D4'; // cyan
      borderColor = '#0E7490';
      label = '☕';
      break;
    case 'rest':
      bgColor = '#6366F1'; // indigo
      borderColor = '#4338CA';
      label = '🛏️';
      break;
    case 'restart':
      bgColor = '#EC4899'; // pink
      borderColor = '#BE185D';
      label = '⚡';
      break;
    default:
      bgColor = '#3B82F6';
      borderColor = '#1D4ED8';
  }

  const html = `
    <div style="
      background-color: ${bgColor};
      border: 2px solid #ffffff;
      box-shadow: 0 3px 6px rgba(0,0,0,0.4);
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: 11px;
      font-family: ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
    ">
      ${label}
    </div>
  `;

  return L.divIcon({
    html,
    className: 'custom-map-marker',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
};

// Component to dynamically fit route bounds whenever geojson changes
function FitBounds({ bounds, sig }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
    }
  }, [sig, map]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// Controller to fly to active clicked stop
function MapFlyController({ selectedStop }) {
  const map = useMap();
  useEffect(() => {
    if (selectedStop && selectedStop.lat && selectedStop.lng) {
      map.flyTo([selectedStop.lat, selectedStop.lng], 10, { duration: 1.2 });
    }
  }, [selectedStop, map]);
  return null;
}

export default function MapView({ route, stops = [], selectedStop, onSelectStop, originLabel = 'Current Location' }) {
  const geojson = route?.geojson;
  const polylineLayerRef = useRef(null);

  // Compute bounding box
  let bounds = null;
  const coords = (geojson?.type === 'Feature' ? geojson.geometry?.coordinates : geojson?.coordinates) || [];
  const routeSig = `${coords.length}-${coords[0]}-${coords[coords.length - 1]}`;
  if (coords.length > 0) {
    const latLngs = coords.map((coord) => [coord[1], coord[0]]);
    bounds = L.latLngBounds(latLngs);
  }

  // First route coordinate for Origin marker: [lat, lng]
  const originCoord = coords.length > 0 ? [coords[0][1], coords[0][0]] : null;

  return (
    <div className="relative w-full h-[460px] rounded-xl overflow-hidden border border-neutral-800 shadow-lg bg-neutral-950">
      <MapContainer
        center={[39.8283, -98.5795]} // Center US
        zoom={4}
        scrollWheelZoom={true}
        className="w-full h-full z-0"
      >
        {/* OpenStreetMap Standard Free Tiles (No API key required) */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Fit Bounds Controller */}
        {bounds && <FitBounds bounds={bounds} sig={routeSig} />}
        {selectedStop && <MapFlyController selectedStop={selectedStop} />}

        {/* Route Polyline GeoJSON */}
        {geojson && (
          <GeoJSON
            key={routeSig}
            data={geojson}
            style={{
              color: '#2563EB',
              weight: 5,
              opacity: 0.85,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        )}

        {/* Origin Marker (Green 'A', at first route coordinate) */}
        {originCoord && (
          <Marker
            position={originCoord}
            icon={createCustomIcon('origin', 'A')}
          >
            <Popup className="custom-popup">
              <div className="p-1 text-neutral-900 font-sans">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                    Origin
                  </span>
                </div>
                <p className="font-bold text-sm text-neutral-900 leading-tight">
                  Origin: {originLabel}
                </p>
              </div>
            </Popup>
          </Marker>
        )}

        {/* Stops Markers */}
        {stops.map((stop, idx) => {
          if (!stop.lat || !stop.lng) return null;
          const isSelected = selectedStop === stop;

          return (
            <Marker
              key={`stop-${idx}`}
              position={[stop.lat, stop.lng]}
              icon={createCustomIcon(stop.type, idx + 1)}
              eventHandlers={{
                click: () => onSelectStop && onSelectStop(stop),
              }}
            >
              <Popup className="custom-popup">
                <div className="p-1 text-neutral-900 font-sans">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
                      {stop.type}
                    </span>
                    <span className="text-xs text-neutral-500 font-mono">
                      Stop #{idx + 1}
                    </span>
                  </div>
                  <p className="font-bold text-sm text-neutral-900 leading-tight">
                    {stop.label}
                  </p>
                  <p className="text-xs text-neutral-600 mt-1">
                    Duration: <span className="font-semibold">{stop.duration_hrs} hrs</span>
                  </p>
                  <p className="text-[11px] text-neutral-500 mt-0.5 font-mono">
                    ETA: {new Date(stop.eta_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} →{' '}
                    {new Date(stop.eta_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {/* Map Legend Floating Overlay */}
      <div className="absolute bottom-3 left-3 z-[1000] bg-neutral-900/90 backdrop-blur-sm border border-neutral-700/80 rounded-lg p-2.5 text-[11px] text-white shadow-lg pointer-events-auto">
        <div className="font-semibold text-neutral-300 mb-1.5">Route Legend:</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span>Origin</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
            <span>Pickup (1h)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span>Fuel (30m)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-500" />
            <span>Break (30m)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
            <span>Rest (10h)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-pink-500" />
            <span>Restart (34h)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

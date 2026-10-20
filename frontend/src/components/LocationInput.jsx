import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Loader2, Check } from 'lucide-react';

export default function LocationInput({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  error = null,
}) {
  const [query, setQuery] = useState(value?.label || '');
  const [candidates, setCandidates] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const wrapperRef = useRef(null);

  // Sync internal text if parent value changes externally (e.g. preset buttons)
  useEffect(() => {
    if (value?.label !== query) {
      setQuery(value?.label || '');
    }
  }, [value]);

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced geocoding search
  useEffect(() => {
    if (!query || query.length < 3 || query === value?.label) {
      setCandidates([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const apiBase = import.meta.env.VITE_API_URL || '';
        const resp = await fetch(`${apiBase}/api/geocode/?q=${encodeURIComponent(query)}`);
        if (resp.ok) {
          const data = await resp.json();
          setCandidates(data || []);
          setIsOpen(true);
        }
      } catch (err) {
        console.error('Geocode search failed', err);
      } finally {
        setIsLoading(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [query, value?.label]);

  const handleSelect = (cand) => {
    // Shorten long Nominatim address label for clean display: e.g. "Chicago, IL, USA"
    const parts = cand.label.split(',').map((p) => p.trim());
    const shortLabel = parts.length > 2 ? `${parts[0]}, ${parts[parts.length - 2]}` : cand.label;

    const loc = {
      label: shortLabel,
      full_label: cand.label,
      lat: cand.lat,
      lng: cand.lng,
    };
    setQuery(shortLabel);
    setIsOpen(false);
    onChange(loc);
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold text-neutral-300 tracking-wide">
          {label} {required && <span className="text-rose-400">*</span>}
        </label>
        {value?.lat && (
          <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
            <Check className="w-3 h-3" /> Coords resolved
          </span>
        )}
      </div>

      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
          <MapPin className="w-4 h-4" />
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (value) {
              // Clear resolved coordinate state until selected again
              onChange(null);
            }
          }}
          onFocus={() => {
            if (candidates.length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          className={`w-full pl-9 pr-9 py-2 bg-neutral-900 border rounded-lg text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 transition ${
            error
              ? 'border-rose-500 focus:ring-rose-500'
              : 'border-neutral-700 focus:border-blue-500 focus:ring-blue-500/20'
          }`}
        />
        {isLoading && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-blue-400">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        )}
      </div>

      {error && <p className="text-[11px] text-rose-400 mt-1">{error}</p>}

      {/* Autocomplete Dropdown */}
      {isOpen && candidates.length > 0 && (
        <ul className="absolute z-[2000] left-0 right-0 mt-1.5 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl max-h-56 overflow-y-auto divide-y divide-neutral-800 text-xs text-white">
          {candidates.map((cand, idx) => (
            <li
              key={idx}
              onClick={() => handleSelect(cand)}
              className="px-3.5 py-2.5 hover:bg-neutral-800 cursor-pointer transition flex items-start gap-2.5"
            >
              <MapPin className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <div className="flex-1 truncate">
                <p className="font-medium truncate text-neutral-100">{cand.label}</p>
                <p className="text-[10px] text-neutral-400 font-mono">
                  {cand.lat.toFixed(4)}, {cand.lng.toFixed(4)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

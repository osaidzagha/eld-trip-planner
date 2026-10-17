import React, { useState } from 'react';
import LocationInput from './LocationInput';
import { Route, Play, Sparkles, AlertCircle, Clock } from 'lucide-react';

export default function TripForm({ onPlanTrip, isLoading, formErrors }) {
  const [current, setCurrent] = useState({
    label: 'Chicago, IL',
    lat: 41.8781,
    lng: -87.6298,
  });
  const [pickup, setPickup] = useState({
    label: 'Dallas, TX',
    lat: 32.7767,
    lng: -96.797,
  });
  const [dropoff, setDropoff] = useState({
    label: 'Atlanta, GA',
    lat: 33.749,
    lng: -84.388,
  });
  const [cycleUsedHrs, setCycleUsedHrs] = useState(30.0);
  const [startDatetime, setStartDatetime] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onPlanTrip({
      current,
      pickup,
      dropoff,
      cycle_used_hrs: parseFloat(cycleUsedHrs),
      start_datetime: startDatetime ? new Date(startDatetime).toISOString() : null,
    });
  };

  // Example Presets
  const loadExample1 = () => {
    setCurrent({ label: 'Chicago, IL', lat: 41.8781, lng: -87.6298 });
    setPickup({ label: 'Dallas, TX', lat: 32.7767, lng: -96.797 });
    setDropoff({ label: 'Atlanta, GA', lat: 33.749, lng: -84.388 });
    setCycleUsedHrs(30.0);
    setStartDatetime('');
  };

  const loadExample2 = () => {
    setCurrent({ label: 'Los Angeles, CA', lat: 34.0522, lng: -118.2437 });
    setPickup({ label: 'Barstow, CA', lat: 34.8958, lng: -117.0173 });
    setDropoff({ label: 'Atlanta, GA', lat: 33.749, lng: -84.388 });
    setCycleUsedHrs(60.0);
    setStartDatetime('');
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 shadow-lg text-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <Route className="w-5 h-5 text-blue-400" />
          <h2 className="text-base font-bold tracking-tight">Trip Configuration</h2>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-neutral-400">Presets:</span>
          <button
            type="button"
            onClick={loadExample1}
            className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded border border-neutral-700 transition"
          >
            Chicago (30h cycle)
          </button>
          <button
            type="button"
            onClick={loadExample2}
            className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded border border-neutral-700 transition"
          >
            Cross-Country (60h cycle)
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Current Location */}
        <LocationInput
          label="Current Location (Start)"
          value={current}
          onChange={setCurrent}
          placeholder="e.g. Chicago, IL"
          required
          error={formErrors?.current}
        />

        {/* Pickup Location */}
        <LocationInput
          label="Pickup Location (1h On-Duty)"
          value={pickup}
          onChange={setPickup}
          placeholder="e.g. Dallas, TX"
          required
          error={formErrors?.pickup}
        />

        {/* Dropoff Location */}
        <LocationInput
          label="Dropoff Location (1h On-Duty)"
          value={dropoff}
          onChange={setDropoff}
          placeholder="e.g. Atlanta, GA"
          required
          error={formErrors?.dropoff}
        />

        {/* Cycle Used Slider / Number */}
        <div className="pt-1">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-neutral-300">
              Current Cycle Used (Hours in 70h/8d window)
            </label>
            <span className="text-xs font-mono font-bold px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded">
              {cycleUsedHrs.toFixed(1)} / 70.0 hrs
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="70"
            step="0.5"
            value={cycleUsedHrs}
            onChange={(e) => setCycleUsedHrs(parseFloat(e.target.value))}
            className="w-full accent-blue-500 cursor-pointer h-1.5 bg-neutral-800 rounded-lg appearance-none"
          />
          <div className="flex justify-between text-[10px] text-neutral-500 mt-1 font-mono">
            <span>0.0 hrs (Fresh)</span>
            <span>35.0 hrs (Mid-cycle)</span>
            <span>70.0 hrs (Limit)</span>
          </div>
          {formErrors?.cycle_used_hrs && (
            <p className="text-[11px] text-rose-400 mt-1">{formErrors.cycle_used_hrs}</p>
          )}
        </div>

        {/* Trip Start Datetime Picker */}
        <div>
          <label className="text-xs font-semibold text-neutral-300 block mb-1.5">
            Trip Start Datetime (Origin Local Time)
          </label>
          <div className="relative">
            <input
              type="datetime-local"
              value={startDatetime}
              onChange={(e) => setStartDatetime(e.target.value)}
              className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-sm text-neutral-200 focus:outline-none focus:border-blue-500 transition"
            />
          </div>
          <p className="text-[10px] text-neutral-400 mt-1">
            Leave blank to default to current time rounded up to next 15-min mark.
          </p>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full mt-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg text-sm shadow-md transition flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              <span>Calculating Route & HOS Compliance...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-white" />
              <span>Plan Trip & Generate Logs</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}

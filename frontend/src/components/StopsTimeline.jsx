import React from 'react';
import { Fuel, Coffee, Moon, RotateCcw, PackageCheck, Package, MapPin } from 'lucide-react';

const getStopIcon = (type) => {
  switch (type) {
    case 'pickup':
      return <Package className="w-4 h-4 text-purple-400" />;
    case 'dropoff':
      return <PackageCheck className="w-4 h-4 text-rose-400" />;
    case 'fuel':
      return <Fuel className="w-4 h-4 text-amber-400" />;
    case 'break':
      return <Coffee className="w-4 h-4 text-cyan-400" />;
    case 'rest':
      return <Moon className="w-4 h-4 text-indigo-400" />;
    case 'restart':
      return <RotateCcw className="w-4 h-4 text-pink-400" />;
    default:
      return <MapPin className="w-4 h-4 text-blue-400" />;
  }
};

const formatTimeSpan = (start, end) => {
  const dStart = new Date(start);
  const dEnd = new Date(end);
  const startStr = dStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const endTime = dEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const endStr = dStart.toDateString() === dEnd.toDateString() ? endTime : `${dEnd.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${endTime}`;
  const dateStr = dStart.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return { dateStr, timeRange: `${startStr} – ${endStr}` };
};

export default function StopsTimeline({ stops = [], selectedStop, onSelectStop }) {
  if (!stops || stops.length === 0) {
    return (
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 text-center text-neutral-400 text-xs">
        No stops generated. Plan a trip above to see stops.
      </div>
    );
  }

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 shadow-lg text-white">
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-neutral-800">
        <h3 className="text-sm font-bold tracking-tight text-neutral-100 flex items-center gap-2">
          <span>Stops & HOS Rest Timeline</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30">
            {stops.length} stops
          </span>
        </h3>
        <span className="text-[11px] text-neutral-400">Click stop to inspect on map</span>
      </div>

      <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
        {stops.map((stop, idx) => {
          const isSelected = selectedStop === stop;
          const { dateStr, timeRange } = formatTimeSpan(stop.eta_start, stop.eta_end);

          return (
            <div
              key={`stop-card-${idx}`}
              onClick={() => onSelectStop && onSelectStop(stop)}
              className={`p-3 rounded-lg border cursor-pointer transition text-xs ${
                isSelected
                  ? 'bg-blue-600/15 border-blue-500 shadow-sm'
                  : 'bg-neutral-850 border-neutral-800 hover:border-neutral-700 hover:bg-neutral-800'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-neutral-900 rounded-md border border-neutral-700/80">
                    {getStopIcon(stop.type)}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-neutral-100 uppercase tracking-wide text-[11px]">
                        #{idx + 1} {stop.type}
                      </span>
                      <span className="text-neutral-500 text-[10px]">• {stop.duration_hrs}h</span>
                    </div>
                    <p className="font-medium text-neutral-200 mt-0.5 truncate max-w-[210px] sm:max-w-xs">
                      {stop.label}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-[10px] font-mono text-neutral-400 block">{dateStr}</span>
                  <span className="text-[11px] font-mono text-neutral-300 font-semibold block">
                    {timeRange}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

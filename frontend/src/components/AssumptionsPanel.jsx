import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Info, Check } from 'lucide-react';

export default function AssumptionsPanel({ assumptions = [] }) {
  const [isOpen, setIsOpen] = useState(false);

  const defaultAssumptions = [
    'Property-carrying driver operating under FMCSA 70-hour / 8-day rules.',
    'Driver starts trip with a fresh shift (10+ consecutive hours off duty beforehand).',
    '11-hour driving limit: maximum 11 hours driving after 10 consecutive hours off-duty (SLEEPER).',
    '14-hour duty window: no driving permitted after the 14th consecutive wall-clock hour from shift start (does not pause for breaks).',
    '30-minute break: required after 8 cumulative hours of driving; satisfied by any 30+ min non-driving period (fuel, rest, pickup, dropoff).',
    'Fuel stop: 30 minutes ON_DUTY_NOT_DRIVING inserted at least once every 1,000 miles.',
    'Pickup and dropoff: 1.0 hour ON_DUTY_NOT_DRIVING each.',
    '34-hour restart (OFF_DUTY): resets the 70-hour cycle clock to 0.0 hrs when the cumulative on-duty hours reach 70.0.',
    'Midnight splitting: logs are sliced midnight-to-midnight in the origin home terminal timezone; each day sums to exactly 24.00 hours.',
  ];

  const items = assumptions.length > 0 ? assumptions : defaultAssumptions;

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-sm text-white">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-neutral-850 transition"
      >
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-semibold text-neutral-200">
            HOS Engine Compliance Assumptions & FMCSA Rules
          </span>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-neutral-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-neutral-400" />
        )}
      </button>

      {isOpen && (
        <div className="p-4 bg-neutral-950/60 border-t border-neutral-800 text-xs text-neutral-300">
          <ul className="space-y-2">
            {items.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2.5">
                <Check className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

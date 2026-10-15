import React from 'react';
import { Clock, Calendar, CheckCircle2, ShieldAlert, Navigation } from 'lucide-react';

export default function SummaryCards({ planResult }) {
  if (!planResult) return null;

  const { route, stops, daily_logs, assumptions } = planResult;
  const totalMiles = route?.total_miles?.toFixed(1) || '0.0';
  const totalDriveHours = route?.total_drive_hours?.toFixed(1) || '0.0';
  const daysCount = daily_logs?.length || 0;
  const stopsCount = stops?.length || 0;

  // Last day recap ending cycle hours
  const lastDay = daily_logs && daily_logs.length > 0 ? daily_logs[daily_logs.length - 1] : null;
  const endingCycleUsed = lastDay?.recap?.cycle_used_total?.toFixed(1) || '0.0';
  const endingCycleAvail = (70.0 - parseFloat(endingCycleUsed)).toFixed(1);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {/* Total Distance */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3.5 shadow-sm">
        <span className="text-[11px] font-medium text-neutral-400 block uppercase tracking-wider">
          Total Distance
        </span>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-xl font-extrabold text-white font-mono">{totalMiles}</span>
          <span className="text-xs text-neutral-400">mi</span>
        </div>
        <span className="text-[10px] text-neutral-500 mt-1 block">2 legs planned</span>
      </div>

      {/* Driving Duration */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3.5 shadow-sm">
        <span className="text-[11px] font-medium text-neutral-400 block uppercase tracking-wider">
          Total Drive Time
        </span>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-xl font-extrabold text-white font-mono">{totalDriveHours}</span>
          <span className="text-xs text-neutral-400">hrs</span>
        </div>
        <span className="text-[10px] text-neutral-500 mt-1 block">Routing API duration</span>
      </div>

      {/* Trip Duration / Days */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3.5 shadow-sm">
        <span className="text-[11px] font-medium text-neutral-400 block uppercase tracking-wider">
          Total Trip Span
        </span>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-xl font-extrabold text-white font-mono">{daysCount}</span>
          <span className="text-xs text-neutral-400">calendar days</span>
        </div>
        <span className="text-[10px] text-neutral-500 mt-1 block">24h midnight-split logs</span>
      </div>

      {/* Required Stops */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3.5 shadow-sm">
        <span className="text-[11px] font-medium text-neutral-400 block uppercase tracking-wider">
          Scheduled Stops
        </span>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-xl font-extrabold text-blue-400 font-mono">{stopsCount}</span>
          <span className="text-xs text-neutral-400">stops</span>
        </div>
        <span className="text-[10px] text-neutral-500 mt-1 block">HOS & fuel compliant</span>
      </div>

      {/* Ending Cycle Remaining */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3.5 shadow-sm col-span-2 sm:col-span-1">
        <span className="text-[11px] font-medium text-neutral-400 block uppercase tracking-wider">
          Cycle Remaining
        </span>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-xl font-extrabold text-emerald-400 font-mono">{endingCycleAvail}</span>
          <span className="text-xs text-neutral-400">/ 70h</span>
        </div>
        <span className="text-[10px] text-neutral-500 mt-1 block">
          Used: {endingCycleUsed} hrs
        </span>
      </div>
    </div>
  );
}

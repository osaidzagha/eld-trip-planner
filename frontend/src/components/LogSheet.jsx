import React, { useRef } from 'react';
import {
  GRID_CONFIG,
  timeToX,
  buildDutyPath,
  extractRemarks,
  STATUS_Y_MAP,
  formatLocationClean,
} from '../utils/logGridGeometry';

/**
 * LogSheet Component:
 * Replicates the standard FMCSA "Driver's Daily Log" as a pure, responsive SVG.
 * Scaled cleanly via viewBox (1000 x 580).
 */
export default function LogSheet({
  day,
  meta = {},
  onMetaChange = () => {},
  dayIndex = 1,
  totalDays = 1,
}) {
  const svgRef = useRef(null);

  if (!day) {
    return <div className="p-8 text-neutral-500">No log data available for this day.</div>;
  }

  const {
    date = '2026-10-12',
    segments = [],
    hours_per_status = {},
    miles_driving_today = 0,
    total_mileage_today = 0,
    recap = {},
  } = day;

  // Format date to MM / DD / YYYY
  const [yearStr, monthStr, dayStr] = date.split('-');
  const formattedDate = `${monthStr || '10'} / ${dayStr || '12'} / ${yearStr || '2026'}`;

  // Default editable metadata
  const carrierName = meta.carrierName ?? 'FREIGHT LOGISTICS CORP';
  const mainOffice = meta.mainOffice ?? '1000 Logistics Way, Suite 400, Chicago, IL';
  const homeTerminal = meta.homeTerminal ?? 'Terminal 12, Gary, IN';
  const truckNumber = meta.truckNumber ?? 'TRK-9042';
  const trailerNumber = meta.trailerNumber ?? 'TRL-5301';
  const rawFrom = meta.fromCity ?? (day.from_city || segments[0]?.location_label || 'Origin');
  const rawTo = meta.toCity ?? (day.to_city || segments[segments.length - 1]?.location_label || 'Destination');
  const fromCity = formatLocationClean(rawFrom);
  const toCity = formatLocationClean(rawTo);
  const shippingDoc = meta.shippingDoc ?? 'BOL-884920-A';
  const commodity = meta.commodity ?? 'General Freight / Electronics';

  // Duty status line path & remarks
  const dutyPath = buildDutyPath(segments, GRID_CONFIG);
  const remarks = extractRemarks(segments, GRID_CONFIG);

  const rowHours = {
    offDuty: (hours_per_status['OFF_DUTY'] || 0).toFixed(2),
    sleeper: (hours_per_status['SLEEPER'] || 0).toFixed(2),
    driving: (hours_per_status['DRIVING'] || 0).toFixed(2),
    onDuty: (hours_per_status['ON_DUTY_NOT_DRIVING'] || 0).toFixed(2),
  };
  const totalDaySum = (
    parseFloat(rowHours.offDuty) +
    parseFloat(rowHours.sleeper) +
    parseFloat(rowHours.driving) +
    parseFloat(rowHours.onDuty)
  ).toFixed(2);

  // Download single sheet as PNG
  const handleDownloadPNG = () => {
    if (!svgRef.current) return;
    const svgElement = svgRef.current;
    const svgString = new XMLSerializer().serializeToString(svgElement);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const URL = window.URL || window.webkitURL || window;
    const blobURL = URL.createObjectURL(svgBlob);

    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2000;
      canvas.height = 1160;
      const context = canvas.getContext('2d');
      context.fillStyle = '#FFFFFF';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const pngURL = canvas.toDataURL('image/png');
      const downloadLink = document.createElement('a');
      downloadLink.href = pngURL;
      downloadLink.download = `Driver_Daily_Log_${date}.png`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    };
    image.src = blobURL;
  };

  return (
    <div className="log-sheet-container bg-white border border-neutral-300 shadow-md rounded-lg p-6 max-w-5xl mx-auto my-4 text-neutral-900 font-sans">
      {/* Top Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between pb-4 mb-4 border-b border-neutral-200 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-neutral-700">Day {dayIndex} of {totalDays}:</span>
          <span className="px-2.5 py-0.5 bg-neutral-100 rounded text-neutral-800 font-mono font-medium">{date}</span>
          <span className="text-xs text-neutral-500 ml-2">Total Hours: {totalDaySum} hrs (Must equal 24.00)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadPNG}
            className="px-3 py-1.5 bg-neutral-900 text-white hover:bg-neutral-800 rounded font-medium text-xs shadow-sm transition"
          >
            Download PNG
          </button>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-300 rounded font-medium text-xs transition"
          >
            Print / Save PDF
          </button>
        </div>
      </div>

      {/* SVG Container */}
      <div className="overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox="0 0 1000 580"
          className="w-full h-auto min-w-[800px] bg-white select-none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Background Canvas */}
          <rect x="0" y="0" width="1000" height="580" fill="#FFFFFF" />

          {/* Outer Border */}
          <rect x="15" y="15" width="970" height="550" fill="none" stroke="#111111" strokeWidth="2" />

          {/* ========================================================================= */}
          {/* HEADER SECTION                                                            */}
          {/* ========================================================================= */}
          <text x="500" y="38" textAnchor="middle" fontSize="16" fontWeight="bold" letterSpacing="2">
            DRIVER'S DAILY LOG
          </text>
          <text x="500" y="52" textAnchor="middle" fontSize="10" fill="#555555">
            (ONE CALENDAR DAY - 24 HOURS • PROPERTY-CARRYING VEHICLE • 49 CFR PART 395)
          </text>

          {/* Date, From, To, Miles row */}
          {/* Header Row 1: Date, From, To, Driving Miles, Total Miles */}
          {/* Date box */}
          <rect x="30" y="65" width="130" height="28" fill="none" stroke="#222" strokeWidth="1" />
          <text x="35" y="76" fontSize="7.5" fill="#666">DATE (M / D / Y)</text>
          <text x="95" y="87" fontSize="10.5" fontWeight="bold" textAnchor="middle">{formattedDate}</text>

          {/* From box */}
          <rect x="165" y="65" width="170" height="28" fill="none" stroke="#222" strokeWidth="1" />
          <text x="170" y="76" fontSize="7.5" fill="#666">FROM (ORIGIN / START)</text>
          <text x="250" y="87" fontSize="9.5" fontWeight="bold" textAnchor="middle">
            {fromCity.length > 24 ? fromCity.slice(0, 22) + '…' : fromCity}
          </text>

          {/* To box */}
          <rect x="340" y="65" width="170" height="28" fill="none" stroke="#222" strokeWidth="1" />
          <text x="345" y="76" fontSize="7.5" fill="#666">TO (DESTINATION / END)</text>
          <text x="425" y="87" fontSize="9.5" fontWeight="bold" textAnchor="middle">
            {toCity.length > 24 ? toCity.slice(0, 22) + '…' : toCity}
          </text>

          {/* Total Miles Today */}
          <rect x="515" y="65" width="110" height="28" fill="none" stroke="#222" strokeWidth="1" />
          <text x="520" y="76" fontSize="7.5" fill="#666">MILES DRIVING</text>
          <text x="570" y="87" fontSize="10.5" fontWeight="bold" textAnchor="middle">{miles_driving_today.toFixed(1)} mi</text>

          {/* Total Mileage */}
          <rect x="630" y="65" width="110" height="28" fill="none" stroke="#222" strokeWidth="1" />
          <text x="635" y="76" fontSize="7.5" fill="#666">TOTAL MILEAGE</text>
          <text x="685" y="87" fontSize="10.5" fontWeight="bold" textAnchor="middle">{total_mileage_today.toFixed(1)} mi</text>

          {/* Truck & Trailer */}
          <rect x="745" y="65" width="225" height="28" fill="none" stroke="#222" strokeWidth="1" />
          <text x="750" y="76" fontSize="7.5" fill="#666">TRUCK / TRACTOR & TRAILER NO.</text>
          <text x="857" y="87" fontSize="10" fontWeight="bold" textAnchor="middle">{truckNumber} / {trailerNumber}</text>

          {/* Header Row 2: Carrier, Office Address, Home Terminal, Shipper/Commodity */}
          <rect x="30" y="97" width="240" height="28" fill="none" stroke="#222" strokeWidth="1" />
          <text x="35" y="108" fontSize="7.5" fill="#666">NAME OF CARRIER</text>
          <text x="150" y="119" fontSize="9.5" fontWeight="bold" textAnchor="middle">{carrierName}</text>

          <rect x="275" y="97" width="255" height="28" fill="none" stroke="#222" strokeWidth="1" />
          <text x="280" y="108" fontSize="7.5" fill="#666">MAIN OFFICE ADDRESS</text>
          <text x="402" y="119" fontSize="8.5" fontWeight="medium" textAnchor="middle">{mainOffice}</text>

          <rect x="535" y="97" width="235" height="28" fill="none" stroke="#222" strokeWidth="1" />
          <text x="540" y="108" fontSize="7.5" fill="#666">HOME TERMINAL ADDRESS</text>
          <text x="652" y="119" fontSize="8.5" fontWeight="medium" textAnchor="middle">{homeTerminal}</text>

          <rect x="775" y="97" width="195" height="28" fill="none" stroke="#222" strokeWidth="1" />
          <text x="780" y="108" fontSize="7.5" fill="#666">SHIPPER & COMMODITY</text>
          <text x="872" y="119" fontSize="8.5" fontWeight="medium" textAnchor="middle">{commodity}</text>

          {/* ========================================================================= */}
          {/* 24-HOUR GRID (Y = 140 to 268)                                              */}
          {/* ========================================================================= */}
          {/* Row Labels (Left of grid) */}
          <rect x="30" y="140" width="130" height="32" fill="#F9FAFB" stroke="#222" strokeWidth="1" />
          <text x="35" y="160" fontSize="9.5" fontWeight="bold">1. OFF DUTY</text>

          <rect x="30" y="172" width="130" height="32" fill="#F9FAFB" stroke="#222" strokeWidth="1" />
          <text x="35" y="192" fontSize="9.5" fontWeight="bold">2. SLEEPER BERTH</text>

          <rect x="30" y="204" width="130" height="32" fill="#F9FAFB" stroke="#222" strokeWidth="1" />
          <text x="35" y="224" fontSize="9.5" fontWeight="bold">3. DRIVING</text>

          <rect x="30" y="236" width="130" height="32" fill="#F9FAFB" stroke="#222" strokeWidth="1" />
          <text x="35" y="256" fontSize="9.5" fontWeight="bold">4. ON DUTY (NOT DRV)</text>

          {/* Grid Box: x: 160 to 880 (width: 720, exactly 30px per hour) */}
          <rect x="160" y="140" width="720" height="128" fill="#FFFFFF" stroke="#222" strokeWidth="1.5" />

          {/* Horizontal Row Divider Lines */}
          <line x1="160" y1="172" x2="880" y2="172" stroke="#444" strokeWidth="1" />
          <line x1="160" y1="204" x2="880" y2="204" stroke="#444" strokeWidth="1" />
          <line x1="160" y1="236" x2="880" y2="236" stroke="#444" strokeWidth="1" />

          {/* Hour & Sub-hour Vertical Grid Lines & Ticks */}
          {Array.from({ length: 25 }).map((_, h) => {
            const x = timeToX(h);
            const isNoon = h === 12;
            const isMidnight = h === 0 || h === 24;
            const hourLabel = isMidnight ? 'Midnight' : isNoon ? 'Noon' : h > 12 ? h - 12 : h;

            return (
              <g key={`hour-${h}`}>
                {/* Top Label */}
                <text
                  x={x}
                  y="135"
                  fontSize={isMidnight || isNoon ? '8.5' : '8'}
                  fontWeight={isMidnight || isNoon ? 'bold' : 'normal'}
                  textAnchor="middle"
                  fill="#111"
                >
                  {hourLabel}
                </text>

                {/* Major vertical grid line */}
                <line
                  x1={x}
                  y1="140"
                  x2={x}
                  y2="268"
                  stroke={isMidnight || isNoon ? '#222' : '#888'}
                  strokeWidth={isMidnight || isNoon ? 1.5 : 0.75}
                />

                {/* Quarter-hour ticks (15 min, 30 min, 45 min) */}
                {h < 24 && (
                  <>
                    {/* 15 min */}
                    <line
                      x1={timeToX(h + 0.25)}
                      y1="140"
                      x2={timeToX(h + 0.25)}
                      y2="268"
                      stroke="#CCCCCC"
                      strokeWidth="0.5"
                      strokeDasharray="2,2"
                    />
                    {/* 30 min (mid tick) */}
                    <line
                      x1={timeToX(h + 0.5)}
                      y1="140"
                      x2={timeToX(h + 0.5)}
                      y2="268"
                      stroke="#AAAAAA"
                      strokeWidth="0.75"
                    />
                    {/* 45 min */}
                    <line
                      x1={timeToX(h + 0.75)}
                      y1="140"
                      x2={timeToX(h + 0.75)}
                      y2="268"
                      stroke="#CCCCCC"
                      strokeWidth="0.5"
                      strokeDasharray="2,2"
                    />
                  </>
                )}
              </g>
            );
          })}

          {/* Total Hours Column (Right of Grid) */}
          <rect x="880" y="140" width="90" height="128" fill="#F9FAFB" stroke="#222" strokeWidth="1.5" />
          <text x="925" y="135" textAnchor="middle" fontSize="8.5" fontWeight="bold">TOTAL</text>

          {/* Row 1 total */}
          <line x1="880" y1="172" x2="970" y2="172" stroke="#444" strokeWidth="1" />
          <text x="925" y="160" textAnchor="middle" fontSize="11" fontWeight="bold">{rowHours.offDuty}</text>

          {/* Row 2 total */}
          <line x1="880" y1="204" x2="970" y2="204" stroke="#444" strokeWidth="1" />
          <text x="925" y="192" textAnchor="middle" fontSize="11" fontWeight="bold">{rowHours.sleeper}</text>

          {/* Row 3 total */}
          <line x1="880" y1="236" x2="970" y2="236" stroke="#444" strokeWidth="1" />
          <text x="925" y="224" textAnchor="middle" fontSize="11" fontWeight="bold">{rowHours.driving}</text>

          {/* Row 4 total */}
          <text x="925" y="256" textAnchor="middle" fontSize="11" fontWeight="bold">{rowHours.onDuty}</text>

          {/* Day Total Hours Summary Box */}
          <rect x="880" y="268" width="90" height="26" fill="#111827" stroke="#222" strokeWidth="1" />
          <text x="925" y="285" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#FFFFFF">
            = {totalDaySum} hrs
          </text>

          {/* ========================================================================= */}
          {/* THE DUTY STATUS PATH LINE (Blue / Distinct Stroke)                        */}
          {/* ========================================================================= */}
          <path
            d={dutyPath}
            fill="none"
            stroke="#2563EB"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Transition points / circles along the duty line */}
          {remarks.map((r, idx) => (
            <circle key={`pt-${idx}`} cx={r.x} cy={r.y} r="3" fill="#1D4ED8" stroke="#FFFFFF" strokeWidth="1" />
          ))}

          {/* ========================================================================= */}
          {/* REMARKS SECTION (Y = 295 to 420)                                          */}
          {/* ========================================================================= */}
          <rect x="30" y="295" width="845" height="125" fill="#FAFAFA" stroke="#222" strokeWidth="1" />
          <text x="40" y="310" fontSize="9" fontWeight="bold" fill="#333">REMARKS (DUTY STATUS CHANGES & LOCATIONS):</text>

          {/* Remarks text list and vertical pointers */}
          {remarks.map((rem, idx) => {
            const isEven = idx % 2 === 0;
            const pointerBottomY = isEven ? 282 : 289;
            const remarkY = 328 + (idx % 6) * 14;
            const remarkX = idx >= 6 ? 440 : 45;

            return (
              <g key={`remark-item-${idx}`}>
                {/* Pointer tick from bottom of grid to remarks */}
                <line
                  x1={rem.x}
                  y1="268"
                  x2={rem.x}
                  y2={pointerBottomY}
                  stroke="#2563EB"
                  strokeWidth="1.2"
                  strokeDasharray="2,2"
                />
                <circle cx={rem.x} cy={pointerBottomY} r="2" fill="#2563EB" />

                {/* Text entry in remarks box */}
                {idx < 12 && (
                  <text x={remarkX} y={remarkY} fontSize="8.5" fill="#111">
                    <tspan fontWeight="bold" fill="#2563EB">{rem.timeLabel}</tspan>
                    <tspan fill="#374151"> - {rem.location || 'Terminal'}</tspan>
                    {rem.reason ? <tspan fill="#6B7280"> - {rem.reason}</tspan> : null}
                  </text>
                )}
              </g>
            );
          })}

          {/* ========================================================================= */}
          {/* RECAP & SHIPPING DOCUMENTS SECTION (Y = 430 to 550)                       */}
          {/* ========================================================================= */}
          {/* Shipping Documents */}
          <rect x="30" y="430" width="380" height="120" fill="none" stroke="#222" strokeWidth="1" />
          <text x="40" y="445" fontSize="9" fontWeight="bold">SHIPPING DOCUMENTS / DRIVER CERTIFICATION:</text>
          <text x="45" y="465" fontSize="8.5" fill="#444">B/L or Manifest No: <tspan fontWeight="bold" fill="#111">{shippingDoc}</tspan></text>
          <text x="45" y="482" fontSize="8.5" fill="#444">Shipper: <tspan fontWeight="bold" fill="#111">{commodity}</tspan></text>
          <text x="45" y="505" fontSize="7.5" fill="#666">
            I certify that these entries are true and correct:
          </text>
          <line x1="45" y1="535" x2="260" y2="535" stroke="#333" strokeWidth="1" />
          <text x="45" y="545" fontSize="7" fill="#666">Driver's Signature</text>

          <line x1="280" y1="535" x2="395" y2="535" stroke="#333" strokeWidth="1" />
          <text x="280" y="545" fontSize="7" fill="#666">Co-Driver / Driver ID</text>

          {/* 70-HOUR / 8-DAY RECAP SECTION */}
          <rect x="420" y="430" width="550" height="120" fill="#F8FAFC" stroke="#222" strokeWidth="1" />
          <text x="430" y="445" fontSize="9.5" fontWeight="bold">
            70 HOUR / 8 DAY RECAP (PROPERTY-CARRYING VEHICLE)
          </text>

          {/* Table headers */}
          <rect x="425" y="455" width="130" height="22" fill="#E2E8F0" stroke="#94A3B8" strokeWidth="0.5" />
          <text x="490" y="469" fontSize="7.5" fontWeight="bold" textAnchor="middle">A. ON DUTY LAST 8 DAYS</text>

          <rect x="560" y="455" width="130" height="22" fill="#E2E8F0" stroke="#94A3B8" strokeWidth="0.5" />
          <text x="625" y="469" fontSize="7.5" fontWeight="bold" textAnchor="middle">B. AVAILABLE TOMORROW</text>

          <rect x="695" y="455" width="130" height="22" fill="#E2E8F0" stroke="#94A3B8" strokeWidth="0.5" />
          <text x="760" y="469" fontSize="7.5" fontWeight="bold" textAnchor="middle">C. TRIP ON DUTY (5 DAYS)*</text>

          <rect x="830" y="455" width="135" height="22" fill="#E2E8F0" stroke="#94A3B8" strokeWidth="0.5" />
          <text x="897" y="469" fontSize="7.5" fontWeight="bold" textAnchor="middle">ON DUTY TODAY (3 & 4)</text>

          {/* Table Values */}
          <rect x="425" y="480" width="130" height="30" fill="#FFFFFF" stroke="#94A3B8" strokeWidth="0.5" />
          <text x="490" y="500" fontSize="12" fontWeight="bold" textAnchor="middle" fill="#0F172A">
            {(recap.cycle_used_total || 0).toFixed(2)} hrs
          </text>

          <rect x="560" y="480" width="130" height="30" fill="#FFFFFF" stroke="#94A3B8" strokeWidth="0.5" />
          <text x="625" y="500" fontSize="12" fontWeight="bold" textAnchor="middle" fill="#16A34A">
            {(recap.available_tomorrow || 0).toFixed(2)} hrs
          </text>

          <rect x="695" y="480" width="130" height="30" fill="#FFFFFF" stroke="#94A3B8" strokeWidth="0.5" />
          <text x="760" y="500" fontSize="12" fontWeight="bold" textAnchor="middle" fill="#0F172A">
            {(recap.on_duty_today || 0).toFixed(2)} hrs
          </text>

          <rect x="830" y="480" width="135" height="30" fill="#FFFFFF" stroke="#94A3B8" strokeWidth="0.5" />
          <text x="897" y="500" fontSize="12" fontWeight="bold" textAnchor="middle" fill="#2563EB">
            {(recap.on_duty_today || 0).toFixed(2)} hrs
          </text>

          {/* Footnote */}
          <text x="430" y="528" fontSize="7" fill="#64748B">
            * 70hr/8day cycle tracked continuously. Pre-trip hours outside current input are unknown.
          </text>
          <text x="430" y="540" fontSize="7" fill="#64748B">
            Column B = 70.0 - Total on duty last 8 days (Col A). A 34-hr restart resets Col A to 0.0 hrs.
          </text>
        </svg>
      </div>

      {/* Editable Inputs Drawer / Accordion */}
      <div className="mt-4 pt-4 border-t border-neutral-200">
        <details className="text-xs text-neutral-600">
          <summary className="font-semibold text-neutral-700 cursor-pointer hover:text-neutral-900">
            Edit Log Sheet Metadata (Carrier, Vehicle, Shipping Docs)
          </summary>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3 p-3 bg-neutral-50 rounded border border-neutral-200">
            <div>
              <label className="block text-neutral-500 mb-1">Carrier Name:</label>
              <input
                type="text"
                value={carrierName}
                onChange={(e) => onMetaChange({ ...meta, carrierName: e.target.value })}
                className="w-full px-2 py-1 bg-white border border-neutral-300 rounded text-xs"
              />
            </div>
            <div>
              <label className="block text-neutral-500 mb-1">Main Office Address:</label>
              <input
                type="text"
                value={mainOffice}
                onChange={(e) => onMetaChange({ ...meta, mainOffice: e.target.value })}
                className="w-full px-2 py-1 bg-white border border-neutral-300 rounded text-xs"
              />
            </div>
            <div>
              <label className="block text-neutral-500 mb-1">Home Terminal Address:</label>
              <input
                type="text"
                value={homeTerminal}
                onChange={(e) => onMetaChange({ ...meta, homeTerminal: e.target.value })}
                className="w-full px-2 py-1 bg-white border border-neutral-300 rounded text-xs"
              />
            </div>
            <div>
              <label className="block text-neutral-500 mb-1">Truck / Tractor No:</label>
              <input
                type="text"
                value={truckNumber}
                onChange={(e) => onMetaChange({ ...meta, truckNumber: e.target.value })}
                className="w-full px-2 py-1 bg-white border border-neutral-300 rounded text-xs"
              />
            </div>
            <div>
              <label className="block text-neutral-500 mb-1">Trailer No:</label>
              <input
                type="text"
                value={trailerNumber}
                onChange={(e) => onMetaChange({ ...meta, trailerNumber: e.target.value })}
                className="w-full px-2 py-1 bg-white border border-neutral-300 rounded text-xs"
              />
            </div>
            <div>
              <label className="block text-neutral-500 mb-1">B/L or Shipping Doc No:</label>
              <input
                type="text"
                value={shippingDoc}
                onChange={(e) => onMetaChange({ ...meta, shippingDoc: e.target.value })}
                className="w-full px-2 py-1 bg-white border border-neutral-300 rounded text-xs"
              />
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

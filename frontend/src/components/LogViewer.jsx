import React, { useState } from 'react';
import LogSheet from './LogSheet';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

/**
 * LogViewer:
 * Multi-day pagination tabs, per-day summary strip, and PDF export for all days.
 */
export default function LogViewer({ dailyLogs = [] }) {
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [meta, setMeta] = useState({
    carrierName: 'FREIGHT LOGISTICS CORP',
    mainOffice: '1000 Logistics Way, Suite 400, Chicago, IL',
    homeTerminal: 'Terminal 12, Gary, IN',
    truckNumber: 'TRK-9042',
    trailerNumber: 'TRL-5301',
    shippingDoc: 'BOL-884920-A',
    commodity: 'General Freight / Electronics',
  });
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  if (!dailyLogs || dailyLogs.length === 0) {
    return (
      <div className="p-8 text-center text-neutral-400">
        No daily log sheets generated yet. Plan a trip to view ELD logs.
      </div>
    );
  }

  const currentLog = dailyLogs[activeDayIndex] || dailyLogs[0];

  // Export all days as one multi-page PDF (one sheet per page)
  const handleDownloadAllPDF = async () => {
    setIsExportingPdf(true);
    try {
      // Letter landscape: 792 x 612 pt with compression enabled
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'pt',
        format: 'letter',
        compress: true,
      });
      const pdfWidth = 792;
      const pdfHeight = 612;

      for (let i = 0; i < dailyLogs.length; i++) {
        setActiveDayIndex(i);
        await new Promise((r) => setTimeout(r, 250));

        const svgEl = document.querySelector('.log-sheet-container svg');
        if (svgEl) {
          const svgString = new XMLSerializer().serializeToString(svgEl);
          const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
          const URL = window.URL || window.webkitURL || window;
          const blobURL = URL.createObjectURL(svgBlob);

          const img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = blobURL;
          });

          // Render at ~1600px width with exact SVG aspect ratio (1000 x 580 = 1.724)
          const targetWidth = 1600;
          const targetHeight = Math.round(targetWidth * (580 / 1000)); // 928px
          const canvas = document.createElement('canvas');
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(blobURL);

          // Render as JPEG with quality 0.92 for dramatically reduced file size
          const imgData = canvas.toDataURL('image/jpeg', 0.92);

          if (i > 0) pdf.addPage('letter', 'landscape');

          // Fit and center the sheet on the page keeping aspect ratio
          // Page: 792 x 612 pt. Available printable area with 24pt margins: 744 x 564 pt
          const maxW = 744;
          const maxH = 564;
          const imgAspect = targetWidth / targetHeight; // 1.724
          let renderW = maxW;
          let renderH = renderW / imgAspect; // ~431.5 pt
          if (renderH > maxH) {
            renderH = maxH;
            renderW = renderH * imgAspect;
          }
          const posX = (pdfWidth - renderW) / 2;
          const posY = (pdfHeight - renderH) / 2;

          pdf.addImage(imgData, 'JPEG', posX, posY, renderW, renderH, undefined, 'FAST');
        }
      }
      pdf.save(`ELD_Daily_Logs_All_Days.pdf`);
    } catch (err) {
      console.error('PDF export failed:', err);
      window.print();
    } finally {
      setIsExportingPdf(false);
    }
  };



  return (
    <div className="w-full my-6">
      {/* Day Tabs & Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4 bg-white p-3 rounded-lg border border-neutral-200 shadow-sm">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {dailyLogs.map((dl, idx) => {
            const isActive = idx === activeDayIndex;
            return (
              <button
                key={dl.date}
                onClick={() => setActiveDayIndex(idx)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                }`}
              >
                Day {idx + 1} ({dl.date.slice(5)})
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveDayIndex((prev) => Math.max(0, prev - 1))}
            disabled={activeDayIndex === 0}
            className="px-2.5 py-1 text-xs border border-neutral-300 rounded hover:bg-neutral-50 disabled:opacity-40"
          >
            ← Prev Day
          </button>
          <span className="text-xs text-neutral-500 font-medium">
            {activeDayIndex + 1} / {dailyLogs.length}
          </span>
          <button
            onClick={() => setActiveDayIndex((prev) => Math.min(dailyLogs.length - 1, prev + 1))}
            disabled={activeDayIndex === dailyLogs.length - 1}
            className="px-2.5 py-1 text-xs border border-neutral-300 rounded hover:bg-neutral-50 disabled:opacity-40"
          >
            Next Day →
          </button>
          <button
            onClick={handleDownloadAllPDF}
            disabled={isExportingPdf}
            className="ml-2 px-3 py-1 bg-neutral-900 text-white hover:bg-neutral-800 text-xs font-medium rounded shadow-sm transition"
          >
            {isExportingPdf ? 'Exporting PDF...' : 'Download All as PDF'}
          </button>
        </div>
      </div>

      {/* Per-Day Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 mb-4 bg-neutral-50 p-3 rounded-lg border border-neutral-200 text-xs">
        <div>
          <span className="text-neutral-500 block">Miles Driving:</span>
          <span className="font-bold text-neutral-800">{currentLog.miles_driving_today} mi</span>
        </div>
        <div>
          <span className="text-neutral-500 block">Driving Time:</span>
          <span className="font-bold text-neutral-800">{currentLog.hours_per_status?.DRIVING?.toFixed(2)}h</span>
        </div>
        <div>
          <span className="text-neutral-500 block">On Duty (Stop/Fuel):</span>
          <span className="font-bold text-neutral-800">{currentLog.hours_per_status?.ON_DUTY_NOT_DRIVING?.toFixed(2)}h</span>
        </div>
        <div>
          <span className="text-neutral-500 block">Sleeper Berth:</span>
          <span className="font-bold text-neutral-800">{currentLog.hours_per_status?.SLEEPER?.toFixed(2)}h</span>
        </div>
        <div>
          <span className="text-neutral-500 block">Cycle Used Total:</span>
          <span className="font-bold text-neutral-800">{currentLog.recap?.cycle_used_total?.toFixed(2)} / 70h</span>
        </div>
        <div>
          <span className="text-neutral-500 block">Available Tomorrow:</span>
          <span className="font-bold text-green-600">{currentLog.recap?.available_tomorrow?.toFixed(2)}h</span>
        </div>
      </div>

      {/* Render Current Day's Log Sheet */}
      <LogSheet
        day={currentLog}
        meta={meta}
        onMetaChange={setMeta}
        dayIndex={activeDayIndex + 1}
        totalDays={dailyLogs.length}
      />
    </div>
  );
}

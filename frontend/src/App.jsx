import React, { useState } from 'react';
import LogViewer from './components/LogViewer';
import TripForm from './components/TripForm';
import MapView from './components/MapView';
import StopsTimeline from './components/StopsTimeline';
import SummaryCards from './components/SummaryCards';
import AssumptionsPanel from './components/AssumptionsPanel';
import chicagoFixture from './chicago_dallas_atlanta.json';
import crossCountryFixture from './cross_country_cycle60.json';
import { Truck, ShieldCheck, Map, FileText, AlertCircle, RefreshCw } from 'lucide-react';

export default function App() {
  // Navigation tabs: 'app' (main interactive planner) or 'dev_logs' (pure log previewer)
  const [activeTab, setActiveTab] = useState('app');

  // Active planned trip result (initialized with Chicago fixture for instant visual preview)
  const [planResult, setPlanResult] = useState(chicagoFixture);
  const [selectedStop, setSelectedStop] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [formErrors, setFormErrors] = useState(null);
  const [apiError, setApiError] = useState(null);

  // Dev mode fixture state
  const [devFixtureKey, setDevFixtureKey] = useState('chicago');
  const activeDevFixture = devFixtureKey === 'chicago' ? chicagoFixture : crossCountryFixture;

  // Cold-start helper: show "waking up" message after 5 s of loading
  const [showWakeUpMsg, setShowWakeUpMsg] = React.useRef(null) && React.useRef(null);
  const wakeUpTimerRef = React.useRef(null);

  // Handle Trip Planning Request
  const handlePlanTrip = async (formData) => {
    setIsLoading(true);
    setFormErrors(null);
    setApiError(null);
    setSelectedStop(null);
    setShowWakeUp(false);

    // After 5 s still loading → show cold-start message
    wakeUpTimerRef.current = setTimeout(() => setShowWakeUp(true), 5000);

    // 90-second timeout via AbortController
    const controller = new AbortController();
    const hardTimeout = setTimeout(() => controller.abort(), 90_000);

    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const resp = await fetch(`${apiBase}/api/plan-trip/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        if (resp.status === 400) {
          setFormErrors(errorData);
        } else {
          setApiError(errorData.error || `Server returned error (${resp.status})`);
        }
        return;
      }

      const data = await resp.json();
      setPlanResult(data);
    } catch (err) {
      if (err.name === 'AbortError') {
        setApiError('Request timed out after 90 seconds. The server may still be waking up — please try again.');
      } else {
        console.error('Trip planning failed:', err);
        setApiError('Network connection failed. Make sure the backend server is running.');
      }
    } finally {
      clearTimeout(wakeUpTimerRef.current);
      clearTimeout(hardTimeout);
      setIsLoading(false);
      setShowWakeUp(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans pb-20 selection:bg-blue-600 selection:text-white">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 bg-neutral-900/90 backdrop-blur-md border-b border-neutral-800 px-6 py-3.5 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center shadow-md">
              <Truck className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-extrabold tracking-tight text-white">
                  Antigravity ELD Trip Planner
                </h1>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  FMCSA 49 CFR § 395
                </span>
              </div>
              <p className="text-xs text-neutral-400">
                Automated HOS Compliance, Route Scheduling & SVG Daily Log Sheets
              </p>
            </div>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-800 text-xs">
            <button
              onClick={() => setActiveTab('app')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition ${
                activeTab === 'app'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Map className="w-3.5 h-3.5" />
              <span>Full Trip Planner</span>
            </button>
            <button
              onClick={() => setActiveTab('dev_logs')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition ${
                activeTab === 'dev_logs'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Log Sheets Dev View</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 mt-6 space-y-6">
        {/* API Error Alert */}
        {apiError && (
          <div className="p-4 bg-rose-950/50 border border-rose-800 rounded-xl text-rose-200 text-xs flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Trip Planning Error</p>
              <p className="mt-0.5 text-rose-300">{apiError}</p>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 1: FULL TRIP PLANNER (FORM + MAP + STOPS + LOGS)                     */}
        {/* ========================================================================= */}
        {activeTab === 'app' && (
          <>
            {/* Top High-Level Metrics Summary */}
            <SummaryCards planResult={planResult} />

            {/* Split Grid: Left Form, Right Map & Timeline */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Form & Assumptions (4 cols) */}
              <div className="lg:col-span-5 space-y-4">
                <TripForm
                  onPlanTrip={handlePlanTrip}
                  isLoading={isLoading}
                  formErrors={formErrors}
                />
                <AssumptionsPanel assumptions={planResult?.assumptions} />
              </div>

              {/* Right Column: Leaflet Map & Stops Timeline (7 cols) */}
              <div className="lg:col-span-7 space-y-4">
                <MapView
                  route={planResult?.route}
                  stops={planResult?.stops}
                  selectedStop={selectedStop}
                  onSelectStop={setSelectedStop}
                />
                <StopsTimeline
                  stops={planResult?.stops}
                  selectedStop={selectedStop}
                  onSelectStop={setSelectedStop}
                />
              </div>
            </div>

            {/* Bottom Full-Width Section: Driver's Daily Log Sheets */}
            <div className="pt-4 border-t border-neutral-800">
              <div className="mb-4">
                <h2 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-400" />
                  <span>FMCSA Driver's Daily Log Sheets</span>
                </h2>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Vector SVG log sheets sliced midnight-to-midnight in origin timezone ({planResult?.timezone || 'UTC'}). Each day sums to exactly 24.00h.
                </p>
              </div>

              {planResult?.daily_logs && planResult.daily_logs.length > 0 ? (
                <LogViewer dailyLogs={planResult.daily_logs} />
              ) : (
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-8 text-center text-neutral-400 text-xs">
                  No daily logs generated yet. Submit the form above to generate daily logs.
                </div>
              )}
            </div>
          </>
        )}

        {/* ========================================================================= */}
        {/* VIEW 2: DEV LOGS PREVIEW (DIRECT FIXTURE SWITCHER)                         */}
        {/* ========================================================================= */}
        {activeTab === 'dev_logs' && (
          <div className="space-y-6">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
              <div>
                <span className="text-neutral-400 block font-medium">Select Fixture to Inspect:</span>
                <span className="font-bold text-sm text-white">
                  {devFixtureKey === 'chicago'
                    ? 'Chicago, IL → Dallas, TX → Atlanta, GA (3 Days)'
                    : '2,500-Mile LA → Atlanta (Cycle: 60h, Day 2 34h Restart)'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDevFixtureKey('chicago')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition ${
                    devFixtureKey === 'chicago'
                      ? 'bg-blue-600 text-white'
                      : 'bg-neutral-800 text-neutral-300 hover:text-white'
                  }`}
                >
                  Chicago (3 Days)
                </button>
                <button
                  onClick={() => setDevFixtureKey('crossCountry')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition ${
                    devFixtureKey === 'crossCountry'
                      ? 'bg-blue-600 text-white'
                      : 'bg-neutral-800 text-neutral-300 hover:text-white'
                  }`}
                >
                  Cross-Country 34h Restart
                </button>
              </div>
            </div>

            <LogViewer dailyLogs={activeDevFixture.daily_logs} />
          </div>
        )}
      </main>
    </div>
  );
}

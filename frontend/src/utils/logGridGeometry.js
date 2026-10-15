/**
 * logGridGeometry.js
 * Pure coordinate geometry functions for the FMCSA Driver's Daily Log 24-hour grid.
 *
 * 4 Duty Status Rows:
 * 1. OFF_DUTY
 * 2. SLEEPER (Sleeper Berth)
 * 3. DRIVING
 * 4. ON_DUTY_NOT_DRIVING (On Duty Not Driving)
 */

export const GRID_CONFIG = {
  // Grid outer boundary within SVG viewBox
  gridLeft: 160,
  gridRight: 880,
  gridTop: 140,
  rowHeight: 32, // 4 rows = 128px total grid height
  rowGap: 0,
};

export const STATUS_ROW_MAP = {
  OFF_DUTY: 1,
  SLEEPER: 2,
  DRIVING: 3,
  ON_DUTY_NOT_DRIVING: 4,
};

export const STATUS_Y_MAP = {
  1: GRID_CONFIG.gridTop + 0.5 * GRID_CONFIG.rowHeight, // Row 1 center
  2: GRID_CONFIG.gridTop + 1.5 * GRID_CONFIG.rowHeight, // Row 2 center
  3: GRID_CONFIG.gridTop + 2.5 * GRID_CONFIG.rowHeight, // Row 3 center
  4: GRID_CONFIG.gridTop + 3.5 * GRID_CONFIG.rowHeight, // Row 4 center
  OFF_DUTY: GRID_CONFIG.gridTop + 0.5 * GRID_CONFIG.rowHeight,
  SLEEPER: GRID_CONFIG.gridTop + 1.5 * GRID_CONFIG.rowHeight,
  DRIVING: GRID_CONFIG.gridTop + 2.5 * GRID_CONFIG.rowHeight,
  ON_DUTY_NOT_DRIVING: GRID_CONFIG.gridTop + 3.5 * GRID_CONFIG.rowHeight,
};

/**
 * Calculates horizontal X coordinate (in SVG units) for a given time of day (0.0 to 24.0 hours).
 * 0.0 -> gridLeft (Midnight)
 * 12.0 -> midpoint (Noon)
 * 24.0 -> gridRight (Midnight)
 */
export function timeToX(hours, config = GRID_CONFIG) {
  const clamped = Math.max(0, Math.min(24, hours));
  const gridWidth = config.gridRight - config.gridLeft;
  return config.gridLeft + (clamped / 24.0) * gridWidth;
}

/**
 * Converts a Date or ISO string into hours (0.0 to 24.0) from midnight.
 */
export function dateToDayHours(dateOrIso) {
  const d = new Date(dateOrIso);
  return d.getHours() + d.getMinutes() / 60.0 + d.getSeconds() / 3600.0;
}

/**
 * Builds SVG path data `d` for duty-status segments of a single day.
 * Generates horizontal segments for the duration of each status,
 * and vertical connector lines at each status change.
 *
 * @param {Array} segments - List of day segments sorted by start time
 * @param {Object} config - Geometry configuration
 * @returns {string} SVG path data string
 */
export function buildDutyPath(segments, config = GRID_CONFIG) {
  if (!segments || segments.length === 0) return '';

  let pathParts = [];
  let prevRow = null;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const rowNum = STATUS_ROW_MAP[seg.status] || 1;
    const y = STATUS_Y_MAP[rowNum];

    // Compute start and end X
    const startHrs = dateToDayHours(seg.start);
    let endHrs = dateToDayHours(seg.end);
    // If end is at next midnight (00:00:00 of next day), treat as 24.0
    if (endHrs === 0 && (new Date(seg.end).getTime() > new Date(seg.start).getTime())) {
      endHrs = 24.0;
    }
    const x1 = timeToX(startHrs, config);
    const x2 = timeToX(endHrs, config);

    if (i === 0) {
      pathParts.push(`M ${x1.toFixed(2)} ${y.toFixed(2)}`);
    } else if (prevRow !== rowNum) {
      // Draw vertical connector at transition point x1
      pathParts.push(`L ${x1.toFixed(2)} ${y.toFixed(2)}`);
    }

    // Draw horizontal segment across the span
    pathParts.push(`L ${x2.toFixed(2)} ${y.toFixed(2)}`);
    prevRow = rowNum;
  }

  return pathParts.join(' ');
}

/**
 * Formats a raw reason/location label into clean "City, ST" without "En route ..." or status text.
 */
export function formatLocationClean(location) {
  if (!location) return '';
  let clean = location;
  // If format is like "Rest Area / Berth (En route to Dallas, TX)", extract the target city
  const enRouteMatch = clean.match(/En route to\s+([^)]+)/i);
  if (enRouteMatch) {
    return enRouteMatch[1].trim();
  }
  // Remove boilerplate prefixes
  clean = clean.replace(/^(Driving towards|Rest Area \/ Berth|Rest Area \/ Truck Stop|Rest Stop|Fuel Station)\s*/i, '').trim();
  clean = clean.replace(/^\((En route[^)]*)\)/i, '').trim();
  clean = clean.replace(/^[-,:\s]+|[-,:\s]+$/g, '').trim();
  return clean || location;
}

/**
 * Extracts remarks points for location/reason callouts at actual status transitions only.
 * Merges consecutive same-status entries. Suppresses midnight-continuations.
 * Format: "HH:MM - City, ST - reason"
 */
export function extractRemarks(segments, config = GRID_CONFIG) {
  if (!segments || segments.length === 0) return [];
  const remarks = [];
  let prevStatus = null;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const startHrs = dateToDayHours(seg.start);
    const x = timeToX(startHrs, config);
    const rowNum = STATUS_ROW_MAP[seg.status] || 1;
    const y = STATUS_Y_MAP[rowNum];

    // Skip initial padding off-duty segment
    if (i === 0 && seg.reason === 'off-duty prior to shift') {
      prevStatus = seg.status;
      continue;
    }

    // Skip if status is unchanged from previous segment (continuation across midnight or split)
    if (prevStatus === seg.status) {
      continue;
    }

    // Format clean time HH:MM
    const startDate = new Date(seg.start);
    const hh = String(startDate.getHours()).padStart(2, '0');
    const mm = String(startDate.getMinutes()).padStart(2, '0');
    const timeLabel = `${hh}:${mm}`;

    // Clean location and reason
    const cleanCity = formatLocationClean(seg.location_label);
    const cleanReason = seg.reason || '';

    // "HH:MM - City, ST - reason"
    let remarkText = `${timeLabel}`;
    if (cleanCity) {
      remarkText += ` - ${cleanCity}`;
    }
    if (cleanReason) {
      remarkText += ` - ${cleanReason}`;
    }

    remarks.push({
      x,
      y,
      timeLabel,
      location: cleanCity,
      reason: cleanReason,
      text: remarkText,
      status: seg.status,
    });

    prevStatus = seg.status;
  }

  return remarks;
}


/**
 * Validates that row hours sum to exactly 24.0
 */
export function validateDayHoursSum(hoursPerStatus) {
  const sum = Object.values(hoursPerStatus || {}).reduce((acc, h) => acc + h, 0);
  return Math.abs(sum - 24.0) < 0.01;
}

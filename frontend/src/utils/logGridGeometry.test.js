import { describe, it, expect } from 'vitest';
import {
  timeToX,
  dateToDayHours,
  buildDutyPath,
  extractRemarks,
  formatLocationClean,
  validateDayHoursSum,
  GRID_CONFIG,
  STATUS_ROW_MAP,
  STATUS_Y_MAP,
} from './logGridGeometry.js';
import chicagoFixture from '../chicago_dallas_atlanta.json';
import crossCountryFixture from '../cross_country_cycle60.json';

describe('logGridGeometry Unit & Invariant Tests', () => {
  // Test 1: X position at 00:00, 06:00, 12:00, 24:00
  it('computes exact X coordinates for key hour boundaries (00:00, 06:00, 12:00, 24:00)', () => {
    expect(timeToX(0)).toBe(160);
    expect(timeToX(6)).toBe(160 + 6 * 30); // 340
    expect(timeToX(12)).toBe(160 + 12 * 30); // 520
    expect(timeToX(24)).toBe(880);
  });

  // Test 2: X positions at 15-minute sub-hour boundaries
  it('computes fractional X positions at 15-minute increments', () => {
    expect(timeToX(0.25)).toBe(160 + 7.5); // 167.5
    expect(timeToX(1.5)).toBe(160 + 45); // 205
    expect(timeToX(23.75)).toBe(880 - 7.5); // 872.5
  });

  // Test 3: Y mapping for all four duty statuses
  it('maps all four duty statuses to expected vertical baseline Y coordinates', () => {
    expect(STATUS_ROW_MAP['OFF_DUTY']).toBe(1);
    expect(STATUS_ROW_MAP['SLEEPER']).toBe(2);
    expect(STATUS_ROW_MAP['DRIVING']).toBe(3);
    expect(STATUS_ROW_MAP['ON_DUTY_NOT_DRIVING']).toBe(4);

    expect(STATUS_Y_MAP[1]).toBe(156);
    expect(STATUS_Y_MAP[2]).toBe(188);
    expect(STATUS_Y_MAP[3]).toBe(220);
    expect(STATUS_Y_MAP[4]).toBe(252);
  });

  // Test 4: Path generation for day with midnight-continuing segment
  it('generates continuous SVG path across midnight without broken points', () => {
    const segments = [
      {
        status: 'SLEEPER',
        start: '2026-10-13T00:00:00',
        end: '2026-10-13T04:30:00',
        reason: '10-hr rest',
      },
      {
        status: 'DRIVING',
        start: '2026-10-13T04:30:00',
        end: '2026-10-13T10:36:00',
        reason: 'driving',
      },
      {
        status: 'ON_DUTY_NOT_DRIVING',
        start: '2026-10-13T10:36:00',
        end: '2026-10-13T11:36:00',
        reason: 'pickup',
      },
    ];
    const path = buildDutyPath(segments);
    expect(path.startsWith('M 160.00 188.00')).toBe(true);
    expect(path).toContain(`L ${timeToX(4.5).toFixed(2)} 220.00`); // vertical drop to driving
    expect(path).toContain(`L ${timeToX(10.6).toFixed(2)} 252.00`); // vertical drop to on-duty
  });

  // Test 5: Vertical connectors occur strictly at status changes and nowhere else
  it('places vertical connectors only at duty status transitions', () => {
    const segments = [
      {
        status: 'DRIVING',
        start: '2026-10-12T07:00:00',
        end: '2026-10-12T12:00:00',
      },
      {
        status: 'DRIVING',
        start: '2026-10-12T12:00:00',
        end: '2026-10-12T15:00:00',
      },
    ];
    const path = buildDutyPath(segments);
    // Two consecutive DRIVING segments should not produce a vertical connector
    const points = path.split(' ').filter((token) => !isNaN(parseFloat(token)));
    // Should be M x y L x y L x y
    expect(path).toBe(`M ${timeToX(7).toFixed(2)} 220.00 L ${timeToX(12).toFixed(2)} 220.00 L ${timeToX(15).toFixed(2)} 220.00`);
  });

  // Test 6: Zero gaps and overlaps between consecutive segments
  it('ensures contiguous span with zero horizontal gaps or overlaps', () => {
    const segments = [
      { status: 'OFF_DUTY', start: '2026-10-12T00:00:00', end: '2026-10-12T07:00:00' },
      { status: 'DRIVING', start: '2026-10-12T07:00:00', end: '2026-10-12T15:00:00' },
      { status: 'SLEEPER', start: '2026-10-12T15:00:00', end: '2026-10-13T00:00:00' },
    ];
    for (let i = 0; i < segments.length - 1; i++) {
      expect(new Date(segments[i].end).getTime()).toBe(new Date(segments[i + 1].start).getTime());
    }
  });

  // Test 7: Row totals sum to exactly 24.00 for all days in Chicago -> Dallas -> Atlanta fixture
  it('verifies that every day sums to exactly 24.00h in Chicago fixture', () => {
    chicagoFixture.daily_logs.forEach((day, idx) => {
      const sum = Object.values(day.hours_per_status).reduce((acc, h) => acc + h, 0);
      expect(Math.abs(sum - 24.0)).toBeLessThan(0.001);
      expect(validateDayHoursSum(day.hours_per_status)).toBe(true);
    });
  });

  // Test 8: Row totals sum to exactly 24.00 for all days in 2,500-mile restart fixture
  it('verifies that every day sums to exactly 24.00h in cross country restart fixture', () => {
    crossCountryFixture.daily_logs.forEach((day, idx) => {
      const sum = Object.values(day.hours_per_status).reduce((acc, h) => acc + h, 0);
      expect(Math.abs(sum - 24.0)).toBeLessThan(0.001);
      expect(validateDayHoursSum(day.hours_per_status)).toBe(true);
    });
  });

  // Test 9: Restart fixture Day 2 is 24 hours pure OFF_DUTY
  it('verifies that Day 2 of the 34-hour restart fixture is a flat 24.00h OFF_DUTY line', () => {
    const day2 = crossCountryFixture.daily_logs[1];
    expect(day2.hours_per_status['OFF_DUTY']).toBe(24.0);
    expect(day2.hours_per_status['DRIVING'] || 0).toBe(0.0);
    expect(day2.hours_per_status['SLEEPER'] || 0).toBe(0.0);
    expect(day2.hours_per_status['ON_DUTY_NOT_DRIVING'] || 0).toBe(0.0);

    const path = buildDutyPath(day2.segments);
    expect(path).toBe('M 160.00 156.00 L 880.00 156.00');
  });

  // Test 10: Remarks generation suppresses midnight-continuation duplicates
  it('does not generate a remark for a segment that merely continues across midnight', () => {
    const segments = [
      {
        status: 'SLEEPER',
        start: '2026-10-13T00:00:00',
        end: '2026-10-13T04:30:00',
        location_label: 'Lonoke County, AR',
        reason: '10-hr rest',
      },
      {
        status: 'SLEEPER',
        start: '2026-10-13T04:30:00',
        end: '2026-10-13T05:00:00',
        location_label: 'Lonoke County, AR',
        reason: '10-hr rest',
      },
      {
        status: 'DRIVING',
        start: '2026-10-13T05:00:00',
        end: '2026-10-13T10:00:00',
        location_label: 'Dallas, TX',
        reason: 'driving',
      },
    ];
    const remarks = extractRemarks(segments);
    // The second SLEEPER segment should be merged with the first, no duplicate remark
    expect(remarks.filter((r) => r.status === 'SLEEPER').length).toBe(1);
    expect(remarks.filter((r) => r.status === 'DRIVING').length).toBe(1);
  });

  // Test 11: Remarks string formatting format: "HH:MM - City, ST - reason"
  it('formats remark text as HH:MM - City, ST - reason without status name in parentheses', () => {
    const segments = [
      {
        status: 'ON_DUTY_NOT_DRIVING',
        start: '2026-10-12T11:36:00',
        end: '2026-10-12T12:36:00',
        location_label: 'Dallas, TX',
        reason: 'Pickup',
      },
    ];
    const remarks = extractRemarks(segments);
    expect(remarks[0].text).toBe('11:36 - Dallas, TX - Pickup');
    expect(remarks[0].text).not.toContain('(');
    expect(remarks[0].text).not.toContain(')');
    expect(remarks[0].text).not.toContain('ON_DUTY');
  });

  // Test 12: formatLocationClean cleans prefixes and boilerplate
  it('removes En route and prefixes from location labels cleanly', () => {
    expect(formatLocationClean('Rest Area / Berth (En route to Dallas, TX)')).toBe('Dallas, TX');
    expect(formatLocationClean('Driving towards Atlanta, GA')).toBe('Atlanta, GA');
    expect(formatLocationClean('Fuel Station - Terrell, Texas')).toBe('Terrell, Texas');
  });

  // Test 13: dateToDayHours correctly handles fractional hours
  it('converts datetime strings to 0-24 floating point day hours', () => {
    expect(dateToDayHours('2026-10-12T00:00:00')).toBe(0.0);
    expect(dateToDayHours('2026-10-12T12:30:00')).toBe(12.5);
    expect(dateToDayHours('2026-10-12T23:45:00')).toBe(23.75);
  });
});

/**
 * Unit tests for the pure night-shift (BCEA s17) calculator.
 *
 * Extracted from overtimeCalculator.test.ts (#2028 file-size split). Tests the
 * pure computeNightHours / parseHm directly AND the producer-level wiring via
 * calculateDailySummary so the s17 behaviour stays covered end-to-end.
 *
 * Night window for these cases: [18:00, 06:00] (wraps midnight).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: vi.fn() }));

import { computeNightHours, parseHm } from '../nightHours';
import {
  calculateDailySummary,
  type AttendanceEntryInput,
  type OvertimeRuleInput,
} from '../overtimeCalculator';

const NIGHT_START = { hour: 18, minute: 0 };
const NIGHT_END = { hour: 6, minute: 0 };

function sast(day: string, hm: string): Date {
  return new Date(`${day}T${hm}:00+02:00`);
}

const BCEA_RULE: OvertimeRuleInput = {
  id: 'rule-bcea-default',
  dailyOrdinaryHrs: 9,
  weeklyOrdinaryHrs: 45,
  weeklyOtCapHrs: 10,
  otMultiplier: 1.5,
  sundayMultiplierDefault: 2.0,
  sundayOrdinaryMultiplier: 1.5,
  holidayMultiplier: 2.0,
  nightShiftAllowance: 0.1,
  nightStart: '18:00',
  nightEnd: '06:00',
};

function summaryFor(inAt: Date, outAt: Date) {
  const entry: AttendanceEntryInput = {
    workDate: '2026-04-20',
    clockInAt: inAt,
    clockOutAt: outAt,
  };
  return calculateDailySummary({
    entry,
    rule: BCEA_RULE,
    publicHolidays: new Set(),
    staffBceaApplicable: true,
  });
}

describe('computeNightHours (pure, s17)', () => {
  it('shift fully at night (22:00 → 06:00 next day) — 8h', () => {
    expect(
      computeNightHours(sast('2026-04-20', '22:00'), sast('2026-04-21', '06:00'), NIGHT_START, NIGHT_END),
    ).toBe(8);
  });

  it('day shift (08:00 → 17:00) — 0h', () => {
    expect(
      computeNightHours(sast('2026-04-20', '08:00'), sast('2026-04-20', '17:00'), NIGHT_START, NIGHT_END),
    ).toBe(0);
  });

  it('mixed shift 16:00 → 02:00 — 8h night', () => {
    expect(
      computeNightHours(sast('2026-04-20', '16:00'), sast('2026-04-21', '02:00'), NIGHT_START, NIGHT_END),
    ).toBe(8);
  });

  it('zero/negative duration — 0h', () => {
    expect(
      computeNightHours(sast('2026-04-20', '10:00'), sast('2026-04-20', '10:00'), NIGHT_START, NIGHT_END),
    ).toBe(0);
  });
});

describe('parseHm', () => {
  it('parses HH:MM and HH:MM:SS', () => {
    expect(parseHm('18:30')).toEqual({ hour: 18, minute: 30 });
    expect(parseHm('06:00:00')).toEqual({ hour: 6, minute: 0 });
  });

  it('throws on malformed or out-of-range', () => {
    expect(() => parseHm('24:00')).toThrow(/out-of-range/);
    expect(() => parseHm('9:00')).toThrow(/invalid time/);
  });
});

describe('calculateDailySummary — night hours wiring (s17)', () => {
  it('mixed shift 16:00 → 02:00 — 8h night, regular 9 + OT 1', () => {
    const s = summaryFor(sast('2026-04-20', '16:00'), sast('2026-04-21', '02:00'));
    expect(s.nightHrs).toBe(8);
    expect(s.regularHrs).toBe(9);
    expect(s.overtimeHrs).toBe(1);
  });

  it('shift crossing two night windows (20:00 Mon → 20:00 Tue, 24h) — 12h night total', () => {
    // 18:00→06:00 each SAST day is 12h night; a 24h shift from 20:00 to 20:00:
    //   20:00 Mon → 24:00 Mon: 4h · 00:00 Tue → 06:00 Tue: 6h ·
    //   06:00 Tue → 18:00 Tue: 0h · 18:00 Tue → 20:00 Tue: 2h → total 12h.
    const s = summaryFor(sast('2026-04-20', '20:00'), sast('2026-04-21', '20:00'));
    // 24h is MAX_PLAUSIBLE_SHIFT_HRS — exactly at the boundary is allowed.
    expect(s.incomplete).toBe(false);
    expect(s.nightHrs).toBe(12);
  });
});

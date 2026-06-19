/**
 * Unit tests for the pure day-type splitter (#1990 / #2028).
 *
 * `computeDayTypeHours` splits a closed shift across SAST calendar days and
 * tallies three disjoint quantities the wage layer needs but cannot recover
 * from bucket totals alone:
 *   - sundayHrs / holidayHrs (disjoint; holiday wins on the same day), and
 *   - overtimeOnNonPremiumHrs — how much of the OT tail lands on ORDINARY
 *     (non-Sunday, non-holiday) calendar time. This is the number that lets
 *     the wage calculator pay the s9/s10 OT premium on a split shift without
 *     double-paying the Sunday/holiday premium.
 *
 * Calendar anchors:
 *   2026-04-18 Sat · 2026-04-19 Sun · 2026-04-20 Mon
 *   2026-04-27 Freedom Day (Mon holiday) · 2026-05-01 Workers' Day (Fri)
 *   2026-12-25 Christmas + 2026-12-26 Day of Goodwill (consecutive holidays)
 *
 * db-pool is mocked so importing the module graph doesn't open a pg.Pool.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: vi.fn() }));

import { computeDayTypeHours, sastYmd } from '../dayTypeHours';

function sast(day: string, hm: string): Date {
  return new Date(`${day}T${hm}:00+02:00`);
}

/** dailyOrdinaryHrs is 9 in every BCEA-default scenario below. */
const DAILY_ORDINARY = 9;

describe('computeDayTypeHours — disjoint Sunday/holiday buckets', () => {
  it('whole-day Sunday — all hours to sundayHrs, holiday 0', () => {
    const r = computeDayTypeHours(
      sast('2026-04-19', '06:00'),
      sast('2026-04-19', '17:00'), // 11h Sunday
      new Set(),
      DAILY_ORDINARY,
    );
    expect(r.sundayHrs).toBe(11);
    expect(r.holidayHrs).toBe(0);
  });

  it('holiday weekday — all hours to holidayHrs, sunday 0', () => {
    const r = computeDayTypeHours(
      sast('2026-04-27', '06:00'),
      sast('2026-04-27', '17:00'), // 11h Freedom Day
      new Set(['2026-04-27']),
      DAILY_ORDINARY,
    );
    expect(r.holidayHrs).toBe(11);
    expect(r.sundayHrs).toBe(0);
  });

  it('holiday that is also Sunday — holiday precedence, sundayHrs 0', () => {
    const r = computeDayTypeHours(
      sast('2026-04-19', '07:00'),
      sast('2026-04-19', '18:00'), // 11h, Sunday + flagged holiday
      new Set(['2026-04-19']),
      DAILY_ORDINARY,
    );
    expect(r.sundayHrs).toBe(0);
    expect(r.holidayHrs).toBe(11);
  });
});

describe('computeDayTypeHours — overtimeOnNonPremiumHrs (the #2028 #1 number)', () => {
  // The OT tail is the hours beyond dailyOrdinaryHrs at the END of the shift.
  // overtimeOnNonPremiumHrs = how many of those OT hours fall on ordinary
  // (non-Sunday, non-holiday) calendar time.

  it('pure weekday with OT — all OT is non-premium', () => {
    // Mon 07:00→17:00 = 10h. OT = 1h (16:00–17:00), all ordinary.
    const r = computeDayTypeHours(
      sast('2026-04-20', '07:00'),
      sast('2026-04-20', '17:00'),
      new Set(),
      DAILY_ORDINARY,
    );
    expect(r.sundayHrs).toBe(0);
    expect(r.holidayHrs).toBe(0);
    expect(r.overtimeOnNonPremiumHrs).toBe(1);
  });

  it('whole-day Sunday with OT — OT is on the Sunday, so non-premium OT is 0', () => {
    // Sun 06:00→17:00 = 11h. OT tail (15:00–17:00, 2h) is ON the Sunday.
    const r = computeDayTypeHours(
      sast('2026-04-19', '06:00'),
      sast('2026-04-19', '17:00'),
      new Set(),
      DAILY_ORDINARY,
    );
    expect(r.sundayHrs).toBe(11);
    expect(r.overtimeOnNonPremiumHrs).toBe(0);
  });

  it('Sat→Sun, OT tail falls ON the Sunday — non-premium OT is 0', () => {
    // Sat 18:00 → Sun 04:00 = 10h. First 9h ordinary (Sat 18:00–24:00=6h +
    // Sun 00:00–03:00=3h), last 1h OT = Sun 03:00–04:00, which is on the
    // Sunday. So overtimeOnNonPremiumHrs = 0, sundayHrs = 4.
    const r = computeDayTypeHours(
      sast('2026-04-18', '18:00'),
      sast('2026-04-19', '04:00'),
      new Set(),
      DAILY_ORDINARY,
    );
    expect(r.sundayHrs).toBe(4);
    expect(r.holidayHrs).toBe(0);
    expect(r.overtimeOnNonPremiumHrs).toBe(0);
  });

  it('Sat→Sun, OT tail straddles Saturday — non-premium OT counts the Saturday part', () => {
    // Sat 13:00 → Sun 01:00 = 12h. First 9h ordinary = Sat 13:00–22:00.
    // OT tail = Sat 22:00–24:00 (2h, ordinary) + Sun 00:00–01:00 (1h, Sunday).
    // sundayHrs = 1; overtimeOnNonPremiumHrs = 2.
    const r = computeDayTypeHours(
      sast('2026-04-18', '13:00'),
      sast('2026-04-19', '01:00'),
      new Set(),
      DAILY_ORDINARY,
    );
    expect(r.sundayHrs).toBe(1);
    expect(r.overtimeOnNonPremiumHrs).toBe(2);
  });

  it('Sun→Mon, OT tail falls on the ordinary Monday — non-premium OT counts it', () => {
    // Sun 20:00 → Mon 06:00 = 10h. First 9h ordinary = Sun 20:00–24:00 (4h) +
    // Mon 00:00–05:00 (5h). OT tail = Mon 05:00–06:00 (1h, ordinary Monday).
    // sundayHrs = 4; overtimeOnNonPremiumHrs = 1.
    const r = computeDayTypeHours(
      sast('2026-04-19', '20:00'),
      sast('2026-04-20', '06:00'),
      new Set(),
      DAILY_ORDINARY,
    );
    expect(r.sundayHrs).toBe(4);
    expect(r.overtimeOnNonPremiumHrs).toBe(1);
  });

  it('weekday→holiday, OT tail on the holiday — non-premium OT is 0', () => {
    // Thu 18:00 → Fri(Workers' Day) 06:00 = 12h. First 9h ordinary = Thu
    // 18:00–24:00 (6h) + Fri 00:00–03:00 (3h). OT tail = Fri 03:00–06:00 (3h,
    // holiday). holidayHrs = 6; overtimeOnNonPremiumHrs = 0.
    const r = computeDayTypeHours(
      sast('2026-04-30', '18:00'),
      sast('2026-05-01', '06:00'),
      new Set(['2026-05-01']),
      DAILY_ORDINARY,
    );
    expect(r.holidayHrs).toBe(6);
    expect(r.sundayHrs).toBe(0);
    expect(r.overtimeOnNonPremiumHrs).toBe(0);
  });

  it('no OT (shift ≤ dailyOrdinaryHrs) — overtimeOnNonPremiumHrs is 0', () => {
    const r = computeDayTypeHours(
      sast('2026-04-18', '22:00'),
      sast('2026-04-19', '06:00'), // 8h Sat→Sun, no OT
      new Set(),
      DAILY_ORDINARY,
    );
    expect(r.sundayHrs).toBe(6);
    expect(r.overtimeOnNonPremiumHrs).toBe(0);
  });
});

describe('sastYmd', () => {
  it('formats a SAST instant to its calendar day', () => {
    expect(sastYmd(sast('2026-04-19', '23:30'))).toBe('2026-04-19');
    // 00:30 SAST on the 20th is still the 20th locally.
    expect(sastYmd(sast('2026-04-20', '00:30'))).toBe('2026-04-20');
  });
});

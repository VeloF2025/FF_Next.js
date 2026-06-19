/**
 * Producer→wage integration for split-shift OT premium (#2028 finding #1).
 *
 * These tests run the REAL calculateDailySummary (which computes the
 * time-ordered overtimeOnNonPremiumHrs) straight into computeWageCents, so we
 * prove the producer and wage calculator agree end-to-end — not just that the
 * wage calculator does the right thing with hand-set fields.
 *
 * These shifts all cross the 18:00–06:00 night window, so the s17 night
 * allowance (10% × rate × night hours) is additive on top of the base pay.
 *
 * Hand-computed expected pay (R120/hr = 12000 cents, BCEA-default rule):
 *   - Sat 13:00→Sun 01:00 (non-ord-Sun): base 9×1 + 2×1.5 + 1×2 = R1680;
 *     night 7h → +R84  → R1764
 *   - Sun 20:00→Mon 06:00 (non-ord-Sun): base 5×1 + 1×1.5 + 4×2 = R1740;
 *     night 10h → +R120 → R1860
 *   - Sat 18:00→Sun 04:00 (non-ord-Sun): base 6×1 + 4×2       = R1680;
 *     night 10h → +R120 → R1800
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: vi.fn() }));

import {
  calculateDailySummary,
  type OvertimeRuleInput,
} from '../overtimeCalculator';
import { computeWageCents } from '../wageCalculator';

const RULE: OvertimeRuleInput = {
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
const RATE = 12000;

function sast(day: string, hm: string): Date {
  return new Date(`${day}T${hm}:00+02:00`);
}

describe('split-shift OT premium — producer→wage end-to-end (#2028)', () => {
  it('Sat 13:00→Sun 01:00: Saturday OT hours keep their 1.5× premium', () => {
    const summary = calculateDailySummary({
      entry: {
        workDate: '2026-04-18',
        clockInAt: sast('2026-04-18', '13:00'),
        clockOutAt: sast('2026-04-19', '01:00'),
      },
      rule: RULE,
      publicHolidays: new Set(),
      staffBceaApplicable: true,
    });
    expect(summary.overtimeHrs).toBe(3);
    expect(summary.sundayHrs).toBe(1);
    expect(summary.overtimeOnNonPremiumHrs).toBe(2);
    expect(summary.nightHrs).toBe(7);
    const cents = computeWageCents({
      summary,
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: false,
    });
    // base 9×1 + 2×1.5 + 1×2 = 168000; night 7h×0.1 = 8400 → 176400.
    expect(cents).toBe(9 * RATE + 2 * RATE * 1.5 + 1 * RATE * 2 + 7 * RATE * 0.1);
  });

  it('Sun 20:00→Mon 06:00: Monday OT hour earns 1.5×, not flat 1×', () => {
    const summary = calculateDailySummary({
      entry: {
        workDate: '2026-04-19',
        clockInAt: sast('2026-04-19', '20:00'),
        clockOutAt: sast('2026-04-20', '06:00'),
      },
      rule: RULE,
      publicHolidays: new Set(),
      staffBceaApplicable: true,
    });
    expect(summary.overtimeHrs).toBe(1);
    expect(summary.sundayHrs).toBe(4);
    expect(summary.overtimeOnNonPremiumHrs).toBe(1);
    expect(summary.nightHrs).toBe(10);
    const cents = computeWageCents({
      summary,
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: false,
    });
    // base 5×1 + 1×1.5 + 4×2 = 174000; night 10h×0.1 = 12000 → 186000.
    expect(cents).toBe(5 * RATE + 1 * RATE * 1.5 + 4 * RATE * 2 + 10 * RATE * 0.1);
  });

  it('Sat 18:00→Sun 04:00: OT tail on Sunday is absorbed by the Sunday premium', () => {
    const summary = calculateDailySummary({
      entry: {
        workDate: '2026-04-18',
        clockInAt: sast('2026-04-18', '18:00'),
        clockOutAt: sast('2026-04-19', '04:00'),
      },
      rule: RULE,
      publicHolidays: new Set(),
      staffBceaApplicable: true,
    });
    expect(summary.overtimeHrs).toBe(1);
    expect(summary.sundayHrs).toBe(4);
    expect(summary.overtimeOnNonPremiumHrs).toBe(0);
    expect(summary.nightHrs).toBe(10);
    const cents = computeWageCents({
      summary,
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: false,
    });
    // base 6×1 + 4×2 = 168000 (no OT premium, OT on Sun); night 10h×0.1 = 12000 → 180000.
    expect(cents).toBe(6 * RATE + 4 * RATE * 2 + 10 * RATE * 0.1);
  });
});

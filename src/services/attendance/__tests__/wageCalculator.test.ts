/**
 * Unit tests for computeWageCents.
 *
 * Pure function — no mocks. Exercises every BCEA branch: weekday with and
 * without OT, bcea_exempt, Sunday ordinary/non-ordinary, public holiday,
 * disjoint Sunday/holiday (additive), split-shift OT-on-non-premium-tail
 * (#2028), night allowance addition, and the null/degenerate cases.
 */

import { describe, it, expect } from 'vitest';
import { computeWageCents } from '../wageCalculator';
import type { DailySummary, OvertimeRuleInput } from '../overtimeCalculator';

const RULE: OvertimeRuleInput = {
  id: 'rule-1',
  dailyOrdinaryHrs: 9,
  weeklyOrdinaryHrs: 45,
  weeklyOtCapHrs: 10,
  otMultiplier: 1.5,
  sundayMultiplierDefault: 2,
  sundayOrdinaryMultiplier: 1.5,
  holidayMultiplier: 2,
  nightShiftAllowance: 0.1,
  nightStart: '18:00',
  nightEnd: '06:00',
};

// R120.00/hr → 12000 cents.
const RATE = 12000;

function summary(overrides: Partial<DailySummary> = {}): DailySummary {
  return {
    regularHrs: 8,
    overtimeHrs: 0,
    sundayHrs: 0,
    holidayHrs: 0,
    nightHrs: 0,
    overtimeOnNonPremiumHrs: 0,
    ruleId: RULE.id,
    computationMode: 'bcea_default',
    incomplete: false,
    weeklyOvertimeOverCap: false,
    ...overrides,
  };
}

describe('computeWageCents', () => {
  it('weekday, no OT: pays regular × rate (R120 × 8 = R960)', () => {
    const cents = computeWageCents({
      summary: summary({ regularHrs: 8 }),
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: false,
    });
    expect(cents).toBe(8 * RATE);
  });

  it('weekday with OT: regular @ 1x + overtime @ 1.5x', () => {
    // 9h regular + 2h OT = R120 × 9 + R120 × 2 × 1.5 = R1080 + R360 = R1440
    // Pure weekday: all OT is non-premium.
    const cents = computeWageCents({
      summary: summary({ regularHrs: 9, overtimeHrs: 2, overtimeOnNonPremiumHrs: 2 }),
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: false,
    });
    expect(cents).toBe(9 * RATE + 2 * RATE * 1.5);
  });

  it('bcea_exempt on Sunday: pays regular only, no stacking', () => {
    // Exempt staff buckets are zeroed by the calculator; guard regardless.
    const cents = computeWageCents({
      summary: summary({ regularHrs: 8, computationMode: 'bcea_exempt' }),
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: true,
    });
    expect(cents).toBe(8 * RATE);
  });

  it('Sunday, ordinarilyWorksSundays=true: entire shift @ 1.5x', () => {
    // 8h on a Sunday. 8 × R120 × 1.5 = R1440.
    const cents = computeWageCents({
      summary: summary({ regularHrs: 8, sundayHrs: 8 }),
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: true,
    });
    expect(cents).toBe(8 * RATE * 1.5);
  });

  it('Sunday, ordinarilyWorksSundays=false: entire shift @ 2x', () => {
    // 8h on a Sunday, non-regular Sunday worker. 8 × R120 × 2 = R1920.
    const cents = computeWageCents({
      summary: summary({ regularHrs: 8, sundayHrs: 8 }),
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: false,
    });
    expect(cents).toBe(8 * RATE * 2);
  });

  it('Sunday with OT: no OT stacking — whole shift at Sunday multiplier', () => {
    // 11h on Sunday (9 regular + 2 OT). Non-regular Sunday worker. The OT is
    // entirely on the Sunday (overtimeOnNonPremiumHrs=0), so the Sunday
    // premium absorbs it — no s9/s10 OT stacking.
    // Expected: 11 × R120 × 2 = R2640. NOT R120 × 9 × 2 + R120 × 2 × 1.5 × 2.
    const cents = computeWageCents({
      summary: summary({
        regularHrs: 9,
        overtimeHrs: 2,
        sundayHrs: 11,
        overtimeOnNonPremiumHrs: 0,
      }),
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: false,
    });
    expect(cents).toBe(11 * RATE * 2);
  });

  it('public holiday weekday: entire shift @ 2x', () => {
    // 9h on a public holiday. 9 × R120 × 2 = R2160.
    const cents = computeWageCents({
      summary: summary({ regularHrs: 9, holidayHrs: 9 }),
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: false,
    });
    expect(cents).toBe(9 * RATE * 2);
  });

  it('cross-midnight Sunday into holiday: premiums are additive per disjoint bucket (#1990)', () => {
    // Sun 16:00 → Mon-holiday 02:00 → sundayHrs=8, holidayHrs=2 (disjoint).
    // The 1h OT tail (Mon 01:00–02:00) is ON the holiday, so
    // overtimeOnNonPremiumHrs=0 and the premium absorbs it.
    // ordinarilyWorksSundays=true → sundayMult=1.5.
    // 8h × R120 × 1.5 + 2h × R120 × 2 = R1440 + R480 = R1920.
    const cents = computeWageCents({
      summary: summary({
        regularHrs: 9,
        overtimeHrs: 1,
        sundayHrs: 8,
        holidayHrs: 2,
        overtimeOnNonPremiumHrs: 0,
      }),
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: true,
    });
    expect(cents).toBe(8 * RATE * 1.5 + 2 * RATE * 2);
  });

  it('cross-midnight non-premium tail — ordinary hours paid at 1x, not dropped', () => {
    // Sat 22:00 → Sun 06:00 (8h total, no OT). The 2h Saturday portion is
    // ordinary (1x); only the 6h Sunday portion earns the Sunday multiplier.
    // nonPremiumOrdinary = 8+0 - 6 - 0 - 0(OT-on-tail) = 2; base = 2×1x + 6×2x.
    const cents = computeWageCents({
      summary: summary({
        regularHrs: 8,
        overtimeHrs: 0,
        sundayHrs: 6,
        holidayHrs: 0,
        overtimeOnNonPremiumHrs: 0,
      }),
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: false,
    });
    expect(cents).toBe(2 * RATE + 6 * RATE * 2);
  });

  it('split shift, OT tail on the ordinary Saturday — OT premium paid, not folded into 1x (#2028)', () => {
    // Sat 13:00 → Sun 01:00 (12h): regular=9, overtime=3, sundayHrs=1,
    // overtimeOnNonPremiumHrs=2 (OT tail = Sat 22:00–24:00 + Sun 00:00–01:00).
    // Correct (non-regular Sunday, sundayMult=2):
    //   9h ordinary @1x + 2h OT @1.5x + 1h Sunday @2x = R1080 + R360 + R240
    //   = R1680 = 168000c. BEFORE the fix the 2 Sat OT hours folded into 1x
    //   → R1560 (under-pay R120).
    const cents = computeWageCents({
      summary: summary({
        regularHrs: 9,
        overtimeHrs: 3,
        sundayHrs: 1,
        holidayHrs: 0,
        overtimeOnNonPremiumHrs: 2,
      }),
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: false,
    });
    expect(cents).toBe(9 * RATE + 2 * RATE * 1.5 + 1 * RATE * 2);
  });

  it('Sun→Mon, OT tail on the ordinary Monday — OT premium paid on the tail (#2028)', () => {
    // Sun 20:00 → Mon 06:00 (10h): regular=9, overtime=1, sundayHrs=4,
    // overtimeOnNonPremiumHrs=1 (OT tail = Mon 05:00–06:00, ordinary).
    // Correct (sundayMult=2): 5h @1x + 1h OT @1.5x + 4h Sunday @2x
    //   = R600 + R180 + R960 = R1740 = 174000c. This is the case a
    //   bucket-totals-only model gets WRONG (can't tell OT tail is on the
    //   ordinary Monday vs. on the Sunday).
    const cents = computeWageCents({
      summary: summary({
        regularHrs: 9,
        overtimeHrs: 1,
        sundayHrs: 4,
        holidayHrs: 0,
        overtimeOnNonPremiumHrs: 1,
      }),
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: false,
    });
    expect(cents).toBe(5 * RATE + 1 * RATE * 1.5 + 4 * RATE * 2);
  });

  it('holiday-on-Sunday (disjoint: sundayHrs=0) — holiday 2× on all hours', () => {
    // #1990: a day that is both Sunday and a holiday emits sundayHrs=0,
    // holidayHrs=11. Wage = 11h × 2× (holiday wins).
    const cents = computeWageCents({
      summary: summary({
        regularHrs: 9,
        overtimeHrs: 2,
        sundayHrs: 0,
        holidayHrs: 11,
        overtimeOnNonPremiumHrs: 0,
      }),
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: true,
    });
    expect(cents).toBe(11 * RATE * 2);
  });

  it('night allowance: additive on top of base', () => {
    // 8h regular including 4h night. Base: 8×R120 = R960. Night: 4×R120×0.1 = R48.
    // Total = R1008 = 100800 cents.
    const cents = computeWageCents({
      summary: summary({ regularHrs: 8, nightHrs: 4 }),
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: false,
    });
    expect(cents).toBe(8 * RATE + 4 * RATE * 0.1);
  });

  it('night + Sunday: allowance additive on top of Sunday multiplier', () => {
    // 8h on a Sunday, 4h inside night window. Non-regular Sunday worker.
    // Base: 8 × 12000 × 2 = 192000. Night: 4 × 12000 × 0.1 = 4800. Total = 196800.
    const cents = computeWageCents({
      summary: summary({ regularHrs: 8, sundayHrs: 8, nightHrs: 4 }),
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: false,
    });
    expect(cents).toBe(8 * RATE * 2 + 4 * RATE * 0.1);
  });

  it('returns null on incomplete summary (missing clock_out)', () => {
    const cents = computeWageCents({
      summary: summary({ incomplete: true }),
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: false,
    });
    expect(cents).toBeNull();
  });

  it('returns null when hourlyRateCents is negative or NaN', () => {
    for (const bad of [NaN, -1, -100, Number.POSITIVE_INFINITY]) {
      expect(
        computeWageCents({
          summary: summary(),
          rule: RULE,
          hourlyRateCents: bad,
          ordinarilyWorksSundays: false,
        })
      ).toBeNull();
    }
  });

  it('zero rate yields zero wage (not null — an explicitly-set R0 is valid)', () => {
    const cents = computeWageCents({
      summary: summary({ regularHrs: 8 }),
      rule: RULE,
      hourlyRateCents: 0,
      ordinarilyWorksSundays: false,
    });
    expect(cents).toBe(0);
  });
});

// hourlyRateCentsFromDbValue tests live in
// __tests__/hourlyRateCentsFromDbValue.test.ts (#2028 file-size split).

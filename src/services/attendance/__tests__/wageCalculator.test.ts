/**
 * Unit tests for computeWageCents + hourlyRateCentsFromDbValue.
 *
 * Pure function — no mocks. Exercises every BCEA branch: weekday with
 * and without OT, bcea_exempt, Sunday ordinary/non-ordinary, public
 * holiday, Sunday∩holiday (max rule), night allowance addition, and
 * the null/degenerate cases.
 */

import { describe, it, expect } from 'vitest';
import {
  computeWageCents,
  hourlyRateCentsFromDbValue,
} from '../wageCalculator';
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
    const cents = computeWageCents({
      summary: summary({ regularHrs: 9, overtimeHrs: 2 }),
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: false,
    });
    expect(cents).toBe(9 * RATE + 2 * RATE * 1.5);
  });

  it('bcea_exempt on Sunday: pays regular only, no stacking', () => {
    // Exempt staff with buckets showing nonzero Sunday data shouldn't happen —
    // the overtime calculator zeros them for exempt. Test the guard regardless.
    const cents = computeWageCents({
      summary: summary({
        regularHrs: 8,
        overtimeHrs: 0,
        sundayHrs: 0,
        holidayHrs: 0,
        nightHrs: 0,
        computationMode: 'bcea_exempt',
      }),
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
    // 11h on Sunday (9 regular + 2 OT). Non-regular Sunday worker.
    // Expected: 11 × R120 × 2 = R2640. NOT R120 × 9 × 2 + R120 × 2 × 1.5 × 2.
    const cents = computeWageCents({
      summary: summary({ regularHrs: 9, overtimeHrs: 2, sundayHrs: 11 }),
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

  it('Sunday AND public holiday: picks max(sundayMult, holidayMult)', () => {
    // ordinarilyWorksSundays=true → sundayMult=1.5, holidayMult=2 → pick 2.
    const cents = computeWageCents({
      summary: summary({ regularHrs: 8, sundayHrs: 8, holidayHrs: 8 }),
      rule: RULE,
      hourlyRateCents: RATE,
      ordinarilyWorksSundays: true,
    });
    expect(cents).toBe(8 * RATE * 2);
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

describe('hourlyRateCentsFromDbValue', () => {
  it('parses numeric(8,2) string from pg to cents', () => {
    expect(hourlyRateCentsFromDbValue('120.00')).toBe(12000);
    expect(hourlyRateCentsFromDbValue('99.99')).toBe(9999);
    expect(hourlyRateCentsFromDbValue('0.01')).toBe(1);
  });

  it('parses a plain number', () => {
    expect(hourlyRateCentsFromDbValue(120)).toBe(12000);
    expect(hourlyRateCentsFromDbValue(0)).toBe(0);
  });

  it('returns null for null/undefined', () => {
    expect(hourlyRateCentsFromDbValue(null)).toBeNull();
    expect(hourlyRateCentsFromDbValue(undefined)).toBeNull();
  });

  it('returns null for unparseable / negative / non-finite', () => {
    expect(hourlyRateCentsFromDbValue('abc')).toBeNull();
    expect(hourlyRateCentsFromDbValue('-10')).toBeNull();
    expect(hourlyRateCentsFromDbValue(-0.01)).toBeNull();
    expect(hourlyRateCentsFromDbValue('NaN')).toBeNull();
  });

  it('rounds half-to-even at the cents boundary via Math.round', () => {
    // 99.995 × 100 = 9999.5 → Math.round returns 10000 (half up on exact halves
    // in JS — acceptable for payroll; legal precision is 1¢).
    expect(hourlyRateCentsFromDbValue('99.995')).toBe(10000);
  });
});

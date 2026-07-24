/**
 * H&S injury-rate maths (§7.6). Mirrors the SQL in analytics/ltifr.ts and pins
 * the worked example verified against a hand calculation.
 */

import { describe, it, expect } from 'vitest';
import { computeRate, deriveRates, RATE_BASE_HOURS } from '../types/ltifr.types';

describe('computeRate', () => {
  it('uses the 200,000-hour base', () => {
    expect(RATE_BASE_HOURS).toBe(200_000);
    // 1 injury over 100,000 hours → 1 × 200000 / 100000 = 2
    expect(computeRate(1, 100_000)).toBe(2);
  });
  it('returns null when there are no hours (avoids divide-by-zero)', () => {
    expect(computeRate(3, 0)).toBeNull();
    expect(computeRate(3, -5)).toBeNull();
  });
  it('rounds to two decimals', () => {
    // 1 × 200000 / 150000 = 1.333… → 1.33
    expect(computeRate(1, 150_000)).toBe(1.33);
  });
});

describe('deriveRates — the hand-checked worked example', () => {
  // Lawley, 100,000 hours: 1 lost_time, 1 restricted_work, 1 medical_treatment,
  // 1 first_aid → LTI 1, disabling 2, recordable 3.
  it('matches the hand calculation (LTIFR 2, DIFR 4, TRIFR 6)', () => {
    const rates = deriveRates({
      hours_worked: 100_000,
      lost_time_injuries: 1,
      disabling_injuries: 2,
      recordable_injuries: 3,
      days_lost: 5,
    });
    expect(rates.ltifr).toBe(2);
    expect(rates.difr).toBe(4);
    expect(rates.trifr).toBe(6);
  });

  it('reports null rates when no hours are captured', () => {
    const rates = deriveRates({ hours_worked: 0, lost_time_injuries: 2, disabling_injuries: 2, recordable_injuries: 2, days_lost: 0 });
    expect(rates.ltifr).toBeNull();
    expect(rates.trifr).toBeNull();
  });
});

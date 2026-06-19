/**
 * Unit tests for hourlyRateCentsFromDbValue.
 *
 * Split out of wageCalculator.test.ts (#2028 file-size split). Converts a
 * staff.hourly_rate numeric(8,2) value (rand) to integer cents.
 */

import { describe, it, expect } from 'vitest';
import { hourlyRateCentsFromDbValue } from '../wageCalculator';

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

  it('rounds half-up at the cents boundary via Math.round', () => {
    // 99.995 × 100 = 9999.5 → Math.round returns 10000 (half up on exact
    // halves in JS — acceptable for payroll; legal precision is 1¢).
    expect(hourlyRateCentsFromDbValue('99.995')).toBe(10000);
  });
});

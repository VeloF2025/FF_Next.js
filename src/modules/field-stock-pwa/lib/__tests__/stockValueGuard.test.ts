/**
 * Unit tests for stockValueGuard.
 *
 * Cap semantics: strictly greater-than (>). A total of exactly R5,000 is
 * allowed; R5,000.01 is blocked. See stockValueGuard.ts design-decision comment.
 */

import { describe, it, expect } from 'vitest';
import {
  checkPendingValueCap,
  PENDING_TECH_VALUE_CAP_ZAR,
} from '../stockValueGuard';

describe('checkPendingValueCap', () => {
  describe('pending technician', () => {
    it('returns over=false when total is under the cap', () => {
      const result = checkPendingValueCap(
        [{ unitValueZar: 1000, quantity: 4 }], // 4000 < 5000
        'pending',
      );
      expect(result.totalZar).toBe(4000);
      expect(result.capZar).toBe(PENDING_TECH_VALUE_CAP_ZAR);
      expect(result.over).toBe(false);
    });

    it('returns over=false when total is exactly at the cap', () => {
      // Cap is strictly > so exactly 5000 must NOT block.
      const result = checkPendingValueCap(
        [{ unitValueZar: 2500, quantity: 2 }], // exactly 5000
        'pending',
      );
      expect(result.totalZar).toBe(5000);
      expect(result.over).toBe(false);
    });

    it('returns over=true when total exceeds the cap', () => {
      const result = checkPendingValueCap(
        [{ unitValueZar: 1200, quantity: 5 }], // 6000 > 5000
        'pending',
      );
      expect(result.totalZar).toBe(6000);
      expect(result.over).toBe(true);
    });

    it('returns over=true for a single high-value item above cap', () => {
      const result = checkPendingValueCap(
        [{ unitValueZar: 5001, quantity: 1 }],
        'pending',
      );
      expect(result.totalZar).toBe(5001);
      expect(result.over).toBe(true);
    });
  });

  describe('active technician — cap never applies', () => {
    it('returns over=false even when total far exceeds 5000', () => {
      const result = checkPendingValueCap(
        [{ unitValueZar: 9999, quantity: 3 }], // 29997
        'active',
      );
      expect(result.totalZar).toBe(29997);
      expect(result.capZar).toBe(Infinity);
      expect(result.over).toBe(false);
    });
  });

  describe('suspended technician — cap never applies', () => {
    it('returns over=false and capZar=Infinity regardless of value', () => {
      const result = checkPendingValueCap(
        [{ unitValueZar: 10000, quantity: 1 }],
        'suspended',
      );
      expect(result.capZar).toBe(Infinity);
      expect(result.over).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles empty lines array — total is 0, not over cap', () => {
      const result = checkPendingValueCap([], 'pending');
      expect(result.totalZar).toBe(0);
      expect(result.over).toBe(false);
    });

    it('handles a line with zero quantity — does not contribute to total', () => {
      const result = checkPendingValueCap(
        [
          { unitValueZar: 9999, quantity: 0 },
          { unitValueZar: 500, quantity: 2 }, // 1000
        ],
        'pending',
      );
      expect(result.totalZar).toBe(1000);
      expect(result.over).toBe(false);
    });

    it('handles multiple lines and sums them correctly', () => {
      const result = checkPendingValueCap(
        [
          { unitValueZar: 1500, quantity: 2 }, // 3000
          { unitValueZar: 800, quantity: 2 },  // 1600 → total 4600
        ],
        'pending',
      );
      expect(result.totalZar).toBe(4600);
      expect(result.over).toBe(false);
    });

    it('avoids IEEE 754 drift on fractional unit values', () => {
      // 0.1 + 0.2 = 0.30000000000000004 without rounding guard
      const result = checkPendingValueCap(
        [{ unitValueZar: 0.1, quantity: 3 }], // 0.3 exactly after rounding
        'pending',
      );
      // Must be 0.3, not 0.30000000000000004
      expect(result.totalZar).toBe(0.3);
    });
  });
});

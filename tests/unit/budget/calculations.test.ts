/**
 * Budget Calculations Unit Tests
 * PRD-057: Project Budget Tracking System
 *
 * TDD Phase: RED - Tests written before implementation
 * These tests will FAIL until src/lib/budget/calculations.ts is implemented
 */

import { describe, it, expect } from 'vitest';
import {
  calculateAvailableBudget,
  calculateVariancePercent,
  calculateUtilization,
} from '../../../lib/budget/calculations';

describe('Budget Calculations', () => {
  describe('calculateAvailableBudget', () => {
    it('BC-001: should return total - committed when committed < total', () => {
      // Input: total=100000, committed=60000
      // Expected: 40000
      const result = calculateAvailableBudget(100000, 60000);
      expect(result).toBe(40000);
    });

    it('BC-002: should return 0 when committed >= total', () => {
      // Input: total=100000, committed=120000
      // Expected: 0 (not negative)
      const result = calculateAvailableBudget(100000, 120000);
      expect(result).toBe(0);
    });

    it('BC-003: should return 0 when committed equals total', () => {
      // Input: total=100000, committed=100000
      // Expected: 0
      const result = calculateAvailableBudget(100000, 100000);
      expect(result).toBe(0);
    });

    it('BC-004: should handle zero budget gracefully', () => {
      // Input: total=0, committed=0
      // Expected: 0
      const result = calculateAvailableBudget(0, 0);
      expect(result).toBe(0);
    });

    it('BC-005: should handle negative committed (edge case)', () => {
      // Input: total=100000, committed=-5000
      // Expected: 100000 (treat negative as 0)
      const result = calculateAvailableBudget(100000, -5000);
      expect(result).toBe(100000);
    });

    it('BC-006: should handle decimal values', () => {
      // Input: total=100000.50, committed=60000.25
      // Expected: 40000.25
      const result = calculateAvailableBudget(100000.50, 60000.25);
      expect(result).toBeCloseTo(40000.25, 2);
    });
  });

  describe('calculateVariancePercent', () => {
    it('BV-001: should calculate positive variance when under budget', () => {
      // Input: total=100000, actual=80000
      // Expected: 20 (20% under budget)
      const result = calculateVariancePercent(100000, 80000);
      expect(result).toBe(20);
    });

    it('BV-002: should calculate negative variance when over budget', () => {
      // Input: total=100000, actual=110000
      // Expected: -10 (10% over budget)
      const result = calculateVariancePercent(100000, 110000);
      expect(result).toBe(-10);
    });

    it('BV-003: should return 0 when total is 0', () => {
      // Input: total=0, actual=5000
      // Expected: 0 (avoid division by zero)
      const result = calculateVariancePercent(0, 5000);
      expect(result).toBe(0);
    });

    it('BV-004: should return 100 when actual is 0', () => {
      // Input: total=100000, actual=0
      // Expected: 100 (100% under budget)
      const result = calculateVariancePercent(100000, 0);
      expect(result).toBe(100);
    });

    it('BV-005: should return 0 when actual equals total', () => {
      // Input: total=100000, actual=100000
      // Expected: 0 (on budget)
      const result = calculateVariancePercent(100000, 100000);
      expect(result).toBe(0);
    });

    it('BV-006: should handle decimal percentages', () => {
      // Input: total=100000, actual=85500
      // Expected: 14.5 (14.5% under budget)
      const result = calculateVariancePercent(100000, 85500);
      expect(result).toBe(14.5);
    });

    it('BV-007: should round to 2 decimal places', () => {
      // Input: total=100000, actual=66666
      // Variance = (100000 - 66666) / 100000 * 100 = 33.334%
      // Expected: 33.33 (rounded)
      const result = calculateVariancePercent(100000, 66666);
      expect(result).toBeCloseTo(33.33, 2);
    });
  });

  describe('calculateUtilization', () => {
    it('BU-001: should calculate utilization percentage correctly', () => {
      // Input: total=100000, committed=75000
      // Expected: 75
      const result = calculateUtilization(100000, 75000);
      expect(result).toBe(75);
    });

    it('BU-002: should show over 100 when over budget', () => {
      // Input: total=100000, committed=150000
      // Expected: 150 (150% utilization)
      const result = calculateUtilization(100000, 150000);
      expect(result).toBe(150);
    });

    it('BU-003: should return 0 when no committed amount', () => {
      // Input: total=100000, committed=0
      // Expected: 0
      const result = calculateUtilization(100000, 0);
      expect(result).toBe(0);
    });

    it('BU-004: should return 0 when total is 0', () => {
      // Input: total=0, committed=5000
      // Expected: 0 (avoid division by zero)
      const result = calculateUtilization(0, 5000);
      expect(result).toBe(0);
    });

    it('BU-005: should return 100 when committed equals total', () => {
      // Input: total=100000, committed=100000
      // Expected: 100
      const result = calculateUtilization(100000, 100000);
      expect(result).toBe(100);
    });

    it('BU-006: should handle decimal percentages', () => {
      // Input: total=100000, committed=85500
      // Expected: 85.5
      const result = calculateUtilization(100000, 85500);
      expect(result).toBe(85.5);
    });

    it('BU-007: should round to 2 decimal places', () => {
      // Input: total=100000, committed=33333
      // Expected: 33.33 (rounded)
      const result = calculateUtilization(100000, 33333);
      expect(result).toBeCloseTo(33.33, 2);
    });
  });
});

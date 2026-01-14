/**
 * Cost Calculator Tests
 * Tests for calculating financial impact of trips
 */

import { describe, it, expect } from 'vitest';
import {
  calculateTripCost,
  calculateTotalCosts,
  DEFAULT_FUEL_RATE,
  DEFAULT_DEPRECIATION_RATE,
  type TripForCost,
} from '@/modules/fleet/services/costCalculator';

describe('costCalculator', () => {
  describe('calculateTripCost', () => {
    it('CC-001: should calculate cost with default rates', () => {
      const trip: TripForCost = {
        distanceKm: 100,
        classification: 'AUTHORIZED',
      };

      const result = calculateTripCost(trip);

      // Default: 3.00/km fuel + 1.50/km depreciation = 4.50/km
      expect(result.totalCost).toBe(450); // 100 * 4.50
      expect(result.fuelCost).toBe(300); // 100 * 3.00
      expect(result.depreciationCost).toBe(150); // 100 * 1.50
    });

    it('CC-002: should calculate cost with custom rates', () => {
      const trip: TripForCost = {
        distanceKm: 100,
        classification: 'AUTHORIZED',
      };

      const result = calculateTripCost(trip, 4.00, 2.00);

      // Custom: 4.00/km fuel + 2.00/km depreciation = 6.00/km
      expect(result.totalCost).toBe(600); // 100 * 6.00
      expect(result.fuelCost).toBe(400); // 100 * 4.00
      expect(result.depreciationCost).toBe(200); // 100 * 2.00
    });

    it('CC-004: should return 0 for zero distance trip', () => {
      const trip: TripForCost = {
        distanceKm: 0,
        classification: 'AUTHORIZED',
      };

      const result = calculateTripCost(trip);

      expect(result.totalCost).toBe(0);
      expect(result.fuelCost).toBe(0);
      expect(result.depreciationCost).toBe(0);
    });

    it('should round to 2 decimal places', () => {
      const trip: TripForCost = {
        distanceKm: 33.33,
        classification: 'AUTHORIZED',
      };

      const result = calculateTripCost(trip);

      // 33.33 * 4.50 = 149.985 → 149.99
      expect(result.totalCost).toBe(149.99);
    });
  });

  describe('calculateTotalCosts', () => {
    it('CC-003: should separate authorized and unauthorized costs', () => {
      const trips: TripForCost[] = [
        { distanceKm: 50, classification: 'AUTHORIZED' },
        { distanceKm: 30, classification: 'UNAUTHORIZED' },
        { distanceKm: 20, classification: 'AUTHORIZED' },
      ];

      const result = calculateTotalCosts(trips);

      // Authorized: 70km * 4.50 = 315
      expect(result.authorizedKm).toBe(70);
      expect(result.authorizedCost).toBe(315);

      // Unauthorized: 30km * 4.50 = 135
      expect(result.unauthorizedKm).toBe(30);
      expect(result.unauthorizedCost).toBe(135);

      // Total: 100km * 4.50 = 450
      expect(result.totalKm).toBe(100);
      expect(result.totalCost).toBe(450);
    });

    it('CC-005: should aggregate multiple trips correctly', () => {
      const trips: TripForCost[] = [
        { distanceKm: 10, classification: 'AUTHORIZED' },
        { distanceKm: 20, classification: 'AUTHORIZED' },
        { distanceKm: 30, classification: 'AUTHORIZED' },
        { distanceKm: 40, classification: 'UNAUTHORIZED' },
      ];

      const result = calculateTotalCosts(trips);

      expect(result.totalKm).toBe(100);
      expect(result.authorizedKm).toBe(60);
      expect(result.unauthorizedKm).toBe(40);
    });

    it('should handle empty trips array', () => {
      const result = calculateTotalCosts([]);

      expect(result.totalKm).toBe(0);
      expect(result.totalCost).toBe(0);
      expect(result.authorizedKm).toBe(0);
      expect(result.unauthorizedKm).toBe(0);
    });

    it('should use custom rates for all trips', () => {
      const trips: TripForCost[] = [
        { distanceKm: 100, classification: 'UNAUTHORIZED' },
      ];

      const result = calculateTotalCosts(trips, 5.00, 2.50);

      // 100km * (5.00 + 2.50) = 750
      expect(result.totalCost).toBe(750);
      expect(result.unauthorizedCost).toBe(750);
    });
  });

  describe('default rates', () => {
    it('should export correct default rates', () => {
      expect(DEFAULT_FUEL_RATE).toBe(3.00);
      expect(DEFAULT_DEPRECIATION_RATE).toBe(1.50);
    });
  });
});

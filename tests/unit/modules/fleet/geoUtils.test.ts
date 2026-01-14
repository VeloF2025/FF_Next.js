/**
 * Geo Utils Tests
 * Tests for Haversine distance and geofencing utilities
 */

import { describe, it, expect } from 'vitest';
import {
  haversineDistance,
  isWithinRadius,
  findNearestLocation,
  type Coordinate,
} from '@/modules/fleet/utils/geoUtils';

describe('geoUtils', () => {
  describe('haversineDistance', () => {
    it('GEO-001: should return 0 for same point', () => {
      const point: Coordinate = { lat: 0, lon: 0 };
      const distance = haversineDistance(point, point);
      expect(distance).toBe(0);
    });

    it('GEO-002: should calculate Lawley → Carletonville correctly (~38km)', () => {
      const lawley: Coordinate = { lat: -26.35, lon: 27.82 };
      const carletonville: Coordinate = { lat: -26.36, lon: 27.40 };

      const distance = haversineDistance(lawley, carletonville);

      // Expected distance is approximately 38-40km
      expect(distance).toBeGreaterThan(36);
      expect(distance).toBeLessThan(42);
    });

    it('GEO-003: should calculate Johannesburg → Cape Town correctly (~1270km)', () => {
      const johannesburg: Coordinate = { lat: -26.2041, lon: 28.0473 };
      const capeTown: Coordinate = { lat: -33.9249, lon: 18.4241 };

      const distance = haversineDistance(johannesburg, capeTown);

      // Expected distance is approximately 1250-1290km
      expect(distance).toBeGreaterThan(1250);
      expect(distance).toBeLessThan(1290);
    });

    it('GEO-004: should calculate cross hemisphere distance (half Earth ~20015km)', () => {
      const point1: Coordinate = { lat: 0, lon: 0 };
      const point2: Coordinate = { lat: 0, lon: 180 };

      const distance = haversineDistance(point1, point2);

      // Half the Earth's circumference is ~20,015km
      expect(distance).toBeGreaterThan(19900);
      expect(distance).toBeLessThan(20100);
    });

    it('GEO-004b: should handle negative latitudes correctly', () => {
      const point1: Coordinate = { lat: -26.35, lon: 27.82 };
      const point2: Coordinate = { lat: -26.36, lon: 27.82 };

      const distance = haversineDistance(point1, point2);

      // Approximately 1.1km apart (just latitude change)
      expect(distance).toBeGreaterThan(1);
      expect(distance).toBeLessThan(2);
    });
  });

  describe('isWithinRadius', () => {
    const center: Coordinate = { lat: -26.35, lon: 27.82 };

    it('GEO-005: should return true for point inside radius', () => {
      // Point approximately 5km from center
      const point: Coordinate = { lat: -26.39, lon: 27.82 };
      const radiusKm = 10;

      const result = isWithinRadius(point, center, radiusKm);

      expect(result).toBe(true);
    });

    it('GEO-006: should return false for point outside radius', () => {
      // Point approximately 40km from center (Carletonville)
      const point: Coordinate = { lat: -26.36, lon: 27.40 };
      const radiusKm = 10;

      const result = isWithinRadius(point, center, radiusKm);

      expect(result).toBe(false);
    });

    it('GEO-007: should return true for point on or just inside boundary', () => {
      // At ~26° latitude, 1 degree ≈ 111.32km, so 9.9km ≈ 0.0889 degrees
      // Using a point just inside the 10km radius
      const point: Coordinate = { lat: center.lat - 0.0889, lon: center.lon };
      const radiusKm = 10;

      const result = isWithinRadius(point, center, radiusKm);

      expect(result).toBe(true);
    });

    it('should return true for same point', () => {
      const result = isWithinRadius(center, center, 1);
      expect(result).toBe(true);
    });
  });

  describe('findNearestLocation', () => {
    const locations = [
      { id: '1', name: 'Location A', lat: -26.35, lon: 27.82, radiusKm: 10 },
      { id: '2', name: 'Location B', lat: -26.50, lon: 27.82, radiusKm: 5 },
      { id: '3', name: 'Location C', lat: -26.36, lon: 27.40, radiusKm: 15 },
    ];

    it('GEO-008: should find nearest location from multiple options', () => {
      const point: Coordinate = { lat: -26.36, lon: 27.81 }; // Slightly south of Location A

      const result = findNearestLocation(point, locations);

      expect(result).not.toBeNull();
      expect(result?.location.name).toBe('Location A');
      expect(result?.distanceKm).toBeLessThan(2);
    });

    it('GEO-009: should return null for empty locations array', () => {
      const point: Coordinate = { lat: -26.35, lon: 27.82 };

      const result = findNearestLocation(point, []);

      expect(result).toBeNull();
    });

    it('should include distance in result', () => {
      const point: Coordinate = { lat: -26.35, lon: 27.82 };

      const result = findNearestLocation(point, locations);

      expect(result).not.toBeNull();
      expect(result?.distanceKm).toBeDefined();
      expect(typeof result?.distanceKm).toBe('number');
    });

    it('should find location furthest point is nearest to', () => {
      // Point near Carletonville (Location C)
      const point: Coordinate = { lat: -26.37, lon: 27.42 };

      const result = findNearestLocation(point, locations);

      expect(result).not.toBeNull();
      expect(result?.location.name).toBe('Location C');
    });
  });
});

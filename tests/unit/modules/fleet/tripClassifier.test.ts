/**
 * Trip Classifier Tests
 * Tests for classifying trips as authorized/unauthorized
 */

import { describe, it, expect } from 'vitest';
import {
  classifyTrip,
  type TripForClassification,
  type AuthorizedLocationForClassification,
} from '@/modules/fleet/services/tripClassifier';

describe('tripClassifier', () => {
  const authorizedLocations: AuthorizedLocationForClassification[] = [
    {
      id: '1',
      name: 'Lawley Work Site',
      lat: -26.35,
      lon: 27.82,
      radiusKm: 10,
      isGlobal: true,
      vehicleId: null,
    },
    {
      id: '2',
      name: 'Carletonville Guesthouse',
      lat: -26.36,
      lon: 27.40,
      radiusKm: 10,
      isGlobal: true,
      vehicleId: null,
    },
  ];

  describe('classifyTrip', () => {
    it('TC-001: should classify trip within authorized start radius as AUTHORIZED', () => {
      const trip: TripForClassification = {
        startLat: -26.35,
        startLon: 27.82, // At Lawley
        endLat: -26.36,
        endLon: 27.40, // At Carletonville
        startTime: new Date('2025-11-03T08:00:00'), // Monday
      };

      const result = classifyTrip(trip, authorizedLocations);

      expect(result.classification).toBe('AUTHORIZED');
    });

    it('TC-002: should classify trip with authorized end as AUTHORIZED', () => {
      const trip: TripForClassification = {
        startLat: -26.36,
        startLon: 27.40, // At Carletonville (authorized)
        endLat: -26.35,
        endLon: 27.82, // At Lawley (authorized)
        startTime: new Date('2025-11-03T17:00:00'), // Monday afternoon
      };

      const result = classifyTrip(trip, authorizedLocations);

      expect(result.classification).toBe('AUTHORIZED');
    });

    it('TC-003: should classify trip outside all authorized locations as UNAUTHORIZED', () => {
      const trip: TripForClassification = {
        startLat: -26.14, // Emperors Palace / Casino area
        startLon: 28.22,
        endLat: -26.15,
        endLon: 28.23,
        startTime: new Date('2025-11-03T20:00:00'), // Monday evening
      };

      const result = classifyTrip(trip, authorizedLocations);

      expect(result.classification).toBe('UNAUTHORIZED');
    });

    it('TC-004: should return WORK_HOURS for trip during work hours', () => {
      const trip: TripForClassification = {
        startLat: -26.35,
        startLon: 27.82,
        endLat: -26.36,
        endLon: 27.40,
        startTime: new Date('2025-11-03T10:00:00'), // Monday 10am
      };

      const result = classifyTrip(trip, authorizedLocations);

      expect(result.timeCategory).toBe('WORK_HOURS');
    });

    it('TC-005: should return AFTER_HOURS for trip after work hours', () => {
      const trip: TripForClassification = {
        startLat: -26.35,
        startLon: 27.82,
        endLat: -26.36,
        endLon: 27.40,
        startTime: new Date('2025-11-03T19:00:00'), // Monday 7pm
      };

      const result = classifyTrip(trip, authorizedLocations);

      expect(result.timeCategory).toBe('AFTER_HOURS');
    });

    it('TC-006: should return NIGHT_TRAVEL for trip at night', () => {
      const trip: TripForClassification = {
        startLat: -26.35,
        startLon: 27.82,
        endLat: -26.36,
        endLon: 27.40,
        startTime: new Date('2025-11-03T23:00:00'), // Monday 11pm
      };

      const result = classifyTrip(trip, authorizedLocations);

      expect(result.timeCategory).toBe('NIGHT_TRAVEL');
    });

    it('TC-007: should return WEEKEND for Saturday trip', () => {
      const trip: TripForClassification = {
        startLat: -26.35,
        startLon: 27.82,
        endLat: -26.36,
        endLon: 27.40,
        startTime: new Date('2025-11-08T10:00:00'), // Saturday 10am
      };

      const result = classifyTrip(trip, authorizedLocations);

      expect(result.dayType).toBe('WEEKEND');
    });

    it('TC-008: should return WEEKDAY for Tuesday trip', () => {
      const trip: TripForClassification = {
        startLat: -26.35,
        startLon: 27.82,
        endLat: -26.36,
        endLon: 27.40,
        startTime: new Date('2025-11-04T10:00:00'), // Tuesday 10am
      };

      const result = classifyTrip(trip, authorizedLocations);

      expect(result.dayType).toBe('WEEKDAY');
    });

    it('TC-009: should flag work hours violation when at unauthorized location during work hours', () => {
      const trip: TripForClassification = {
        startLat: -26.14, // Unauthorized location (Emperors Palace area)
        startLon: 28.22,
        endLat: -26.15,
        endLon: 28.23,
        startTime: new Date('2025-11-04T10:00:00'), // Tuesday 10am (work hours)
      };

      const result = classifyTrip(trip, authorizedLocations);

      expect(result.isWorkHoursViolation).toBe(true);
    });

    it('TC-010: should use global locations for classification', () => {
      const trip: TripForClassification = {
        startLat: -26.35, // Lawley (global location)
        startLon: 27.82,
        endLat: -26.36,
        endLon: 27.40, // Carletonville (global location)
        startTime: new Date('2025-11-03T08:00:00'),
      };

      const result = classifyTrip(trip, authorizedLocations);

      expect(result.classification).toBe('AUTHORIZED');
      expect(result.nearestAuthLocation).toBeDefined();
    });

    it('TC-011: should use vehicle-specific override over global location', () => {
      const vehicleId = 'vehicle-123';
      const vehicleLocations: AuthorizedLocationForClassification[] = [
        // Global location at Lawley
        {
          id: '1',
          name: 'Lawley Work Site',
          lat: -26.35,
          lon: 27.82,
          radiusKm: 10,
          isGlobal: true,
          vehicleId: null,
        },
        // Vehicle-specific location at different place
        {
          id: '3',
          name: 'Vehicle Specific Site',
          lat: -26.50,
          lon: 27.90,
          radiusKm: 5,
          isGlobal: false,
          vehicleId: vehicleId,
        },
      ];

      const trip: TripForClassification = {
        startLat: -26.50, // At vehicle-specific location
        startLon: 27.90,
        endLat: -26.51,
        endLon: 27.91,
        startTime: new Date('2025-11-03T08:00:00'),
      };

      const result = classifyTrip(trip, vehicleLocations, vehicleId);

      expect(result.classification).toBe('AUTHORIZED');
      expect(result.nearestAuthLocation).toBe('Vehicle Specific Site');
    });

    it('should include distance from nearest authorized location', () => {
      const trip: TripForClassification = {
        startLat: -26.14, // Far from any authorized location
        startLon: 28.22,
        endLat: -26.15,
        endLon: 28.23,
        startTime: new Date('2025-11-03T20:00:00'),
      };

      const result = classifyTrip(trip, authorizedLocations);

      expect(result.distanceFromAuthKm).toBeDefined();
      expect(result.distanceFromAuthKm).toBeGreaterThan(0);
    });
  });
});

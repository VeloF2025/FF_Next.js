/**
 * GPS Parser Tests
 * Tests for Excel GPS data parsing and trip extraction
 */

import { describe, it, expect } from 'vitest';
import {
  extractTripsFromPoints,
  parseEventType,
  fuzzyMatchColumn,
  type GPSPoint,
} from '@/modules/fleet/services/gpsParser';

describe('gpsParser', () => {
  describe('parseEventType', () => {
    it('should parse "Ignition On" as IGNITION_ON', () => {
      expect(parseEventType('Ignition On')).toBe('IGNITION_ON');
      expect(parseEventType('IGNITION ON')).toBe('IGNITION_ON');
      expect(parseEventType('ignition on')).toBe('IGNITION_ON');
    });

    it('should parse "Ignition Off" as IGNITION_OFF', () => {
      expect(parseEventType('Ignition Off')).toBe('IGNITION_OFF');
      expect(parseEventType('IGNITION OFF')).toBe('IGNITION_OFF');
    });

    it('should parse movement types', () => {
      expect(parseEventType('Driving')).toBe('MOVEMENT');
      expect(parseEventType('Moving')).toBe('MOVEMENT');
    });

    it('should return UNKNOWN for unrecognized types', () => {
      expect(parseEventType('Something else')).toBe('UNKNOWN');
      expect(parseEventType('')).toBe('UNKNOWN');
    });
  });

  describe('fuzzyMatchColumn', () => {
    it('should match latitude variants', () => {
      expect(fuzzyMatchColumn('Latitude', 'latitude')).toBe(true);
      expect(fuzzyMatchColumn('Lat', 'latitude')).toBe(true);
      expect(fuzzyMatchColumn('lat', 'latitude')).toBe(true);
    });

    it('should match longitude variants', () => {
      expect(fuzzyMatchColumn('Longitude', 'longitude')).toBe(true);
      expect(fuzzyMatchColumn('Long', 'longitude')).toBe(true);
      expect(fuzzyMatchColumn('Lng', 'longitude')).toBe(true);
      expect(fuzzyMatchColumn('lon', 'longitude')).toBe(true);
    });

    it('should match date variants', () => {
      expect(fuzzyMatchColumn('Date', 'date')).toBe(true);
      expect(fuzzyMatchColumn('DateTime', 'date')).toBe(true);
      expect(fuzzyMatchColumn('Timestamp', 'date')).toBe(true);
    });

    it('should match event type variants', () => {
      expect(fuzzyMatchColumn('Case', 'eventType')).toBe(true);
      expect(fuzzyMatchColumn('Event', 'eventType')).toBe(true);
      expect(fuzzyMatchColumn('Type', 'eventType')).toBe(true);
      expect(fuzzyMatchColumn('Status', 'eventType')).toBe(true);
    });

    it('should return false for non-matching columns', () => {
      expect(fuzzyMatchColumn('Random', 'latitude')).toBe(false);
      expect(fuzzyMatchColumn('Other', 'longitude')).toBe(false);
    });
  });

  describe('extractTripsFromPoints', () => {
    it('GPS-002: should extract trips from Ignition On/Off markers', () => {
      const points: GPSPoint[] = [
        {
          timestamp: new Date('2025-11-01T08:00:00'),
          latitude: -26.35,
          longitude: 27.82,
          location: 'Start',
          speed: 0,
          odometer: 1000,
          fuel: 50,
          eventType: 'IGNITION_ON',
        },
        {
          timestamp: new Date('2025-11-01T08:15:00'),
          latitude: -26.36,
          longitude: 27.81,
          location: 'Mid',
          speed: 60,
          odometer: 1010,
          fuel: 49,
          eventType: 'MOVEMENT',
        },
        {
          timestamp: new Date('2025-11-01T08:30:00'),
          latitude: -26.37,
          longitude: 27.80,
          location: 'End',
          speed: 0,
          odometer: 1020,
          fuel: 48,
          eventType: 'IGNITION_OFF',
        },
      ];

      const trips = extractTripsFromPoints(points);

      expect(trips.length).toBe(1);
      expect(trips[0].tripNumber).toBe(1);
      expect(trips[0].startTime).toEqual(new Date('2025-11-01T08:00:00'));
      expect(trips[0].endTime).toEqual(new Date('2025-11-01T08:30:00'));
      expect(trips[0].durationMinutes).toBe(30);
    });

    it('GPS-009: should handle consecutive Ignition On without Off', () => {
      const points: GPSPoint[] = [
        {
          timestamp: new Date('2025-11-01T08:00:00'),
          latitude: -26.35,
          longitude: 27.82,
          location: 'Start 1',
          speed: 0,
          odometer: 1000,
          fuel: 50,
          eventType: 'IGNITION_ON',
        },
        {
          timestamp: new Date('2025-11-01T08:30:00'),
          latitude: -26.38,
          longitude: 27.78,
          location: 'Mid 1',
          speed: 60,
          odometer: 1025,
          fuel: 48,
          eventType: 'MOVEMENT',
        },
        // Missing IGNITION_OFF - second IGNITION_ON ends first trip
        {
          timestamp: new Date('2025-11-01T09:00:00'),
          latitude: -26.40,
          longitude: 27.75,
          location: 'Start 2',
          speed: 0,
          odometer: 1050,
          fuel: 45,
          eventType: 'IGNITION_ON',
        },
        {
          timestamp: new Date('2025-11-01T09:30:00'),
          latitude: -26.42,
          longitude: 27.73,
          location: 'End 2',
          speed: 0,
          odometer: 1070,
          fuel: 43,
          eventType: 'IGNITION_OFF',
        },
      ];

      const trips = extractTripsFromPoints(points);

      // Should create 2 trips - first one ends at second IGNITION_ON
      expect(trips.length).toBe(2);
    });

    it('GPS-010: should handle trips with zero distance', () => {
      const points: GPSPoint[] = [
        {
          timestamp: new Date('2025-11-01T08:00:00'),
          latitude: -26.35,
          longitude: 27.82,
          location: 'Same Location',
          speed: 0,
          odometer: 1000,
          fuel: 50,
          eventType: 'IGNITION_ON',
        },
        {
          timestamp: new Date('2025-11-01T08:10:00'),
          latitude: -26.35,
          longitude: 27.82,
          location: 'Same Location',
          speed: 0,
          odometer: 1000,
          fuel: 50,
          eventType: 'IGNITION_OFF',
        },
      ];

      const trips = extractTripsFromPoints(points);

      expect(trips.length).toBe(1);
      expect(trips[0].distanceKm).toBe(0);
    });

    it('should calculate trip distance correctly', () => {
      const points: GPSPoint[] = [
        {
          timestamp: new Date('2025-11-01T08:00:00'),
          latitude: -26.35,
          longitude: 27.82,
          location: 'Lawley',
          speed: 0,
          odometer: 1000,
          fuel: 50,
          eventType: 'IGNITION_ON',
        },
        {
          timestamp: new Date('2025-11-01T08:15:00'),
          latitude: -26.36,
          longitude: 27.60,
          location: 'Midpoint',
          speed: 80,
          odometer: 1020,
          fuel: 48,
          eventType: 'MOVEMENT',
        },
        {
          timestamp: new Date('2025-11-01T08:30:00'),
          latitude: -26.36,
          longitude: 27.40,
          location: 'Carletonville',
          speed: 0,
          odometer: 1040,
          fuel: 46,
          eventType: 'IGNITION_OFF',
        },
      ];

      const trips = extractTripsFromPoints(points);

      expect(trips.length).toBe(1);
      // Distance should be calculated from route, not straight line
      expect(trips[0].distanceKm).toBeGreaterThan(30);
      expect(trips[0].distanceKm).toBeLessThan(50);
    });

    it('should return empty array for empty points', () => {
      const trips = extractTripsFromPoints([]);
      expect(trips).toEqual([]);
    });

    it('should return empty array for points with no IGNITION_ON', () => {
      const points: GPSPoint[] = [
        {
          timestamp: new Date('2025-11-01T08:00:00'),
          latitude: -26.35,
          longitude: 27.82,
          location: 'Location',
          speed: 0,
          odometer: 1000,
          fuel: 50,
          eventType: 'MOVEMENT',
        },
      ];

      const trips = extractTripsFromPoints(points);
      expect(trips).toEqual([]);
    });
  });
});

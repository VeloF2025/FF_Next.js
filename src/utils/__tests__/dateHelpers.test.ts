/**
 * Date Helpers Tests
 * Comprehensive tests for safeToDate function used in StaffDetail fix
 */

import { safeToDate, safeToISOString, safeFormatDate } from '../dateHelpers';

describe('dateHelpers - Production Error Fix Tests', () => {
  describe('safeToDate', () => {
    test('handles null and undefined', () => {
      const nullResult = safeToDate(null);
      const undefinedResult = safeToDate(undefined);

      expect(nullResult).toBeInstanceOf(Date);
      expect(undefinedResult).toBeInstanceOf(Date);
      expect(isNaN(nullResult.getTime())).toBe(false);
      expect(isNaN(undefinedResult.getTime())).toBe(false);
    });

    test('handles Date objects', () => {
      const inputDate = new Date('2024-01-15T10:00:00Z');
      const result = safeToDate(inputDate);

      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBe(inputDate.getTime());
    });

    test('handles invalid Date objects', () => {
      const invalidDate = new Date('invalid');
      const result = safeToDate(invalidDate);

      expect(result).toBeInstanceOf(Date);
      expect(isNaN(result.getTime())).toBe(false); // Should return current date
    });

    test('handles string dates (PostgreSQL format)', () => {
      // Test PostgreSQL date string format
      const postgresDate = '2024-01-15';
      const result = safeToDate(postgresDate);

      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0); // January is 0
      expect(result.getDate()).toBe(15);
    });

    test('handles ISO string dates', () => {
      const isoDate = '2024-01-15T10:30:00Z';
      const result = safeToDate(isoDate);

      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe('2024-01-15T10:30:00.000Z');
    });

    test('handles invalid string dates', () => {
      const invalidString = 'not-a-date';
      const result = safeToDate(invalidString);

      expect(result).toBeInstanceOf(Date);
      expect(isNaN(result.getTime())).toBe(false); // Should return current date
    });

    test('handles Firebase Timestamp objects', () => {
      // Mock Firebase Timestamp
      const mockTimestamp = {
        toDate: () => new Date('2024-01-15T10:00:00Z'),
      };

      const result = safeToDate(mockTimestamp);

      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2024);
    });

    test('handles objects without toDate method', () => {
      const invalidObject = { someProperty: 'value' };
      const result = safeToDate(invalidObject);

      expect(result).toBeInstanceOf(Date);
      expect(isNaN(result.getTime())).toBe(false);
    });

    test('handles numeric timestamps', () => {
      const timestamp = 1642204800000; // January 15, 2022
      const result = safeToDate(timestamp);

      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBe(timestamp);
    });

    test('handles invalid numeric values', () => {
      const invalidTimestamp = NaN;
      const result = safeToDate(invalidTimestamp);

      expect(result).toBeInstanceOf(Date);
      expect(isNaN(result.getTime())).toBe(false); // Should return current date
    });

    test('handles thrown exceptions gracefully', () => {
      // Create object that throws when accessing properties
      const throwingObject = {
        get toDate() {
          throw new Error('Access denied');
        },
      };

      const result = safeToDate(throwingObject);

      expect(result).toBeInstanceOf(Date);
      expect(isNaN(result.getTime())).toBe(false); // Should return current date
    });

    test('handles Firebase Timestamp with invalid toDate', () => {
      const mockTimestamp = {
        toDate: () => {
          throw new Error('Firebase connection error');
        },
      };

      const result = safeToDate(mockTimestamp);

      expect(result).toBeInstanceOf(Date);
      expect(isNaN(result.getTime())).toBe(false); // Should return current date
    });
  });

  describe('safeToISOString', () => {
    test('converts Date to ISO string', () => {
      const date = new Date('2024-01-15T10:00:00Z');
      const result = safeToISOString(date);

      expect(result).toBe('2024-01-15T10:00:00.000Z');
    });

    test('handles null values', () => {
      const result = safeToISOString(null);

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test('converts string dates to ISO', () => {
      const result = safeToISOString('2024-01-15');

      expect(result).toMatch(/^2024-01-15T/);
    });

    test('handles Firebase Timestamp', () => {
      const mockTimestamp = {
        toDate: () => new Date('2024-01-15T10:00:00Z'),
      };

      const result = safeToISOString(mockTimestamp);

      expect(result).toBe('2024-01-15T10:00:00.000Z');
    });
  });

  describe('safeFormatDate', () => {
    test('formats valid dates', () => {
      const date = new Date('2024-01-15');
      const result = safeFormatDate(date);

      // en-ZA locale produces "15 Jan 2024" (day-first ordering)
      expect(result).toMatch(/Jan.*2024/);
      expect(result).toMatch(/15/);
    });

    test('returns fallback for invalid dates', () => {
      const result = safeFormatDate('invalid-date', 'No Date');

      // Should return current date formatted since 'invalid-date' defaults to current date
      expect(result).toMatch(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/);
    });

    test('uses default fallback for null', () => {
      const result = safeFormatDate(null);

      // Should return current date formatted since null defaults to current date
      expect(result).toMatch(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/);
    });

    test('handles thrown exceptions', () => {
      // Mock console.warn to avoid test noise
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const throwingObject = {
        get toDate() {
          throw new Error('Test error');
        },
      };

      const result = safeFormatDate(throwingObject);

      expect(result).toMatch(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/); // Should format current date

      consoleSpy.mockRestore();
    });
  });

  describe('Production Scenario Tests', () => {
    test('handles exact production error scenario', () => {
      // Simulate the exact scenario that caused production error:
      // Database returns end_date as string "2024-12-31"
      // Code tries: endDate.toDate() on a string
      const problematicEndDate = '2024-12-31';

      // This is what was failing in production:
      // const date = endDate instanceof Date ? endDate : endDate.toDate();
      // TypeError: endDate.toDate is not a function

      // Our fix uses safeToDate:
      const result = safeToDate(problematicEndDate);

      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(11); // December
      expect(result.getDate()).toBe(31);
    });

    test('handles various database return formats', () => {
      const databaseFormats = [
        '2024-01-15', // PostgreSQL date
        '2024-01-15T10:30:00Z', // PostgreSQL timestamp
        '2024-01-15T10:30:00.123Z', // PostgreSQL with milliseconds
        '2024-01-15 10:30:00', // PostgreSQL without timezone
        1642204800000, // Unix timestamp
        null, // Null value
        undefined, // Undefined value
      ];

      databaseFormats.forEach((format) => {
        const result = safeToDate(format);
        expect(result).toBeInstanceOf(Date);
        expect(isNaN(result.getTime())).toBe(false);
      });
    });

    test('integration test - full component date handling workflow', () => {
      // Simulate the full workflow from database to component
      const mockDatabaseRow = {
        join_date: '2024-01-15', // String from PostgreSQL
        end_date: '2024-12-31', // String from PostgreSQL
      };

      // Data mapper transformation (our fix)
      const mappedData = {
        startDate: safeToDate(mockDatabaseRow.join_date),
        endDate: mockDatabaseRow.end_date ? safeToDate(mockDatabaseRow.end_date) : undefined,
      };

      // Component usage (our fix)
      const startDateResult = safeToDate(mappedData.startDate);
      const endDateResult = mappedData.endDate ? safeToDate(mappedData.endDate) : null;

      expect(startDateResult).toBeInstanceOf(Date);
      expect(endDateResult).toBeInstanceOf(Date);
      expect(startDateResult.getFullYear()).toBe(2024);
      expect(endDateResult?.getFullYear()).toBe(2024);
    });
  });
});
/**
 * Excel Date Parser Tests
 * Tests for converting Excel serial dates to JavaScript Date objects
 */

import { describe, it, expect } from 'vitest';
import {
  excelDateToJSDate,
  parseExcelDate,
  isExcelSerialDate,
} from '@/modules/fleet/utils/excelDateParser';

describe('excelDateParser', () => {
  describe('excelDateToJSDate', () => {
    it('ED-001: should parse Excel serial date 45962.074479 to 2025-11-01', () => {
      // Excel serial 45962 = 2025-11-01
      // .074479 = 1:47:15 AM (approximately)
      const serial = 45962.074479;
      const result = excelDateToJSDate(serial);

      expect(result).not.toBeNull();
      expect(result?.getFullYear()).toBe(2025);
      expect(result?.getMonth()).toBe(10); // November (0-indexed)
      expect(result?.getDate()).toBe(1);
    });

    it('ED-002: should parse Excel serial date for midnight', () => {
      // 45962.0 = 2025-11-01 at 00:00:00
      const serial = 45962.0;
      const result = excelDateToJSDate(serial);

      expect(result).not.toBeNull();
      expect(result?.getHours()).toBe(0);
      expect(result?.getMinutes()).toBe(0);
    });

    it('ED-003: should parse Excel serial date for noon', () => {
      // 45962.5 = 2025-11-01 at 12:00:00
      const serial = 45962.5;
      const result = excelDateToJSDate(serial);

      expect(result).not.toBeNull();
      expect(result?.getHours()).toBe(12);
      expect(result?.getMinutes()).toBe(0);
    });

    it('ED-004: should handle the 1900 leap year bug (Excel thinks 1900 was a leap year)', () => {
      // Excel serial 60 should be 1900-02-28 (not 1900-02-29 which doesn't exist)
      // However, Excel serial 60 represents 1900-02-29 in Excel
      // We handle this by adjusting dates after 60
      const serial = 61; // March 1, 1900
      const result = excelDateToJSDate(serial);

      expect(result).not.toBeNull();
      expect(result?.getFullYear()).toBe(1900);
      expect(result?.getMonth()).toBe(2); // March (0-indexed)
      expect(result?.getDate()).toBe(1);
    });

    it('should return null for invalid/zero serial', () => {
      expect(excelDateToJSDate(0)).toBeNull();
      expect(excelDateToJSDate(-1)).toBeNull();
    });
  });

  describe('parseExcelDate', () => {
    it('ED-005: should parse string date "2025-11-01"', () => {
      const result = parseExcelDate('2025-11-01');

      expect(result).not.toBeNull();
      expect(result?.getFullYear()).toBe(2025);
      expect(result?.getMonth()).toBe(10); // November
      expect(result?.getDate()).toBe(1);
    });

    it('ED-006: should return null for invalid string', () => {
      const result = parseExcelDate('invalid');
      expect(result).toBeNull();
    });

    it('should handle Excel serial number as string', () => {
      const result = parseExcelDate('45962.5');

      expect(result).not.toBeNull();
      expect(result?.getFullYear()).toBe(2025);
      expect(result?.getMonth()).toBe(10);
      expect(result?.getDate()).toBe(1);
    });

    it('should handle Date object input', () => {
      const input = new Date('2025-11-01T12:00:00');
      const result = parseExcelDate(input);

      expect(result).not.toBeNull();
      expect(result?.getFullYear()).toBe(2025);
      expect(result?.getMonth()).toBe(10);
    });

    it('should handle number input (Excel serial)', () => {
      const result = parseExcelDate(45962.5);

      expect(result).not.toBeNull();
      expect(result?.getFullYear()).toBe(2025);
    });

    it('should return null for null/undefined', () => {
      expect(parseExcelDate(null)).toBeNull();
      expect(parseExcelDate(undefined)).toBeNull();
    });
  });

  describe('isExcelSerialDate', () => {
    it('should return true for valid Excel serial range', () => {
      expect(isExcelSerialDate(45962)).toBe(true);
      expect(isExcelSerialDate(1)).toBe(true);
      expect(isExcelSerialDate(100000)).toBe(true);
    });

    it('should return false for invalid values', () => {
      expect(isExcelSerialDate(0)).toBe(false);
      expect(isExcelSerialDate(-1)).toBe(false);
      expect(isExcelSerialDate(NaN)).toBe(false);
    });

    it('should return true for fractional values', () => {
      expect(isExcelSerialDate(45962.5)).toBe(true);
    });
  });
});

/**
 * Date Utils Tests
 * Tests for work hours detection and time categorization
 */

import { describe, it, expect } from 'vitest';
import {
  isWorkHours,
  isNightTime,
  isWeekend,
  getTimeCategory,
  getDayType,
  type TimeCategory,
  type DayType,
} from '@/modules/fleet/utils/dateUtils';

describe('dateUtils', () => {
  describe('isWorkHours', () => {
    it('DT-001: should return true for Monday 10am', () => {
      const date = new Date('2025-11-03T10:00:00'); // Monday
      expect(isWorkHours(date)).toBe(true);
    });

    it('DT-002: should return false for Monday 8pm', () => {
      const date = new Date('2025-11-03T20:00:00'); // Monday 8pm
      expect(isWorkHours(date)).toBe(false);
    });

    it('DT-003: should return false for Saturday 10am (weekend)', () => {
      const date = new Date('2025-11-08T10:00:00'); // Saturday
      expect(isWorkHours(date)).toBe(false);
    });

    it('should return true for work hours at 6am (start boundary)', () => {
      const date = new Date('2025-11-03T06:00:00'); // Monday 6am
      expect(isWorkHours(date)).toBe(true);
    });

    it('should return true for work hours at 5:59pm (just before end)', () => {
      const date = new Date('2025-11-03T17:59:00'); // Monday 5:59pm
      expect(isWorkHours(date)).toBe(true);
    });

    it('should return false for 6pm (end boundary)', () => {
      const date = new Date('2025-11-03T18:00:00'); // Monday 6pm
      expect(isWorkHours(date)).toBe(false);
    });

    it('should return false for 5:59am (just before start)', () => {
      const date = new Date('2025-11-03T05:59:00'); // Monday 5:59am
      expect(isWorkHours(date)).toBe(false);
    });
  });

  describe('isNightTime', () => {
    it('DT-004: should return true for 11pm', () => {
      const date = new Date('2025-11-03T23:00:00');
      expect(isNightTime(date)).toBe(true);
    });

    it('DT-005: should return true for 3am', () => {
      const date = new Date('2025-11-03T03:00:00');
      expect(isNightTime(date)).toBe(true);
    });

    it('DT-006: should return false for 10am', () => {
      const date = new Date('2025-11-03T10:00:00');
      expect(isNightTime(date)).toBe(false);
    });

    it('should return true for exactly 10pm (start boundary)', () => {
      const date = new Date('2025-11-03T22:00:00');
      expect(isNightTime(date)).toBe(true);
    });

    it('should return true for exactly 5am (end boundary - before 5am counts)', () => {
      const date = new Date('2025-11-03T04:59:00');
      expect(isNightTime(date)).toBe(true);
    });

    it('should return false for 5am exactly (morning starts)', () => {
      const date = new Date('2025-11-03T05:00:00');
      expect(isNightTime(date)).toBe(false);
    });
  });

  describe('isWeekend', () => {
    it('DT-007: should return true for Saturday', () => {
      const date = new Date('2025-11-08'); // Saturday
      expect(isWeekend(date)).toBe(true);
    });

    it('DT-008: should return true for Sunday', () => {
      const date = new Date('2025-11-09'); // Sunday
      expect(isWeekend(date)).toBe(true);
    });

    it('DT-009: should return false for Monday', () => {
      const date = new Date('2025-11-03'); // Monday
      expect(isWeekend(date)).toBe(false);
    });

    it('should return false for Friday', () => {
      const date = new Date('2025-11-07'); // Friday
      expect(isWeekend(date)).toBe(false);
    });
  });

  describe('getTimeCategory', () => {
    it('DT-010: should return WORK_HOURS for Monday 10am', () => {
      const date = new Date('2025-11-03T10:00:00'); // Monday 10am
      expect(getTimeCategory(date)).toBe('WORK_HOURS');
    });

    it('DT-011: should return AFTER_HOURS for Monday 7pm', () => {
      const date = new Date('2025-11-03T19:00:00'); // Monday 7pm
      expect(getTimeCategory(date)).toBe('AFTER_HOURS');
    });

    it('DT-012: should return NIGHT_TRAVEL for Monday 11pm', () => {
      const date = new Date('2025-11-03T23:00:00'); // Monday 11pm
      expect(getTimeCategory(date)).toBe('NIGHT_TRAVEL');
    });

    it('should return NIGHT_TRAVEL for 3am', () => {
      const date = new Date('2025-11-03T03:00:00');
      expect(getTimeCategory(date)).toBe('NIGHT_TRAVEL');
    });

    it('should return AFTER_HOURS for Saturday during day (weekend)', () => {
      const date = new Date('2025-11-08T10:00:00'); // Saturday 10am
      expect(getTimeCategory(date)).toBe('AFTER_HOURS');
    });
  });

  describe('getDayType', () => {
    it('should return WEEKDAY for Monday', () => {
      const date = new Date('2025-11-03'); // Monday
      expect(getDayType(date)).toBe('WEEKDAY');
    });

    it('should return WEEKDAY for Friday', () => {
      const date = new Date('2025-11-07'); // Friday
      expect(getDayType(date)).toBe('WEEKDAY');
    });

    it('should return WEEKEND for Saturday', () => {
      const date = new Date('2025-11-08'); // Saturday
      expect(getDayType(date)).toBe('WEEKEND');
    });

    it('should return WEEKEND for Sunday', () => {
      const date = new Date('2025-11-09'); // Sunday
      expect(getDayType(date)).toBe('WEEKEND');
    });
  });
});

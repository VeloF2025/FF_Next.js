/**
 * Tests for src/modules/field-workers/timeHelpers.ts
 *
 * Covers:
 *  - getCurrentSastWeek: correct Mon–Sun range for several weekdays
 *  - formatHours: decimal-to-h/m display
 *  - safeFormatTime: null/empty handling
 *  - fromLocalDatetimeValue / toLocalDatetimeValue: SAST ↔ UTC round-trip
 */

import { describe, it, expect } from 'vitest';
import {
  getCurrentSastWeek,
  formatHours,
  safeFormatTime,
  fromLocalDatetimeValue,
  toLocalDatetimeValue,
} from '../timeHelpers';

// ── getCurrentSastWeek ────────────────────────────────────────────────────────

describe('getCurrentSastWeek', () => {
  /**
   * In SAST (UTC+2), 2026-06-24 is a Wednesday.
   * Week Mon=2026-06-22 … Sun=2026-06-28.
   *
   * We pass new Date('2026-06-24T10:00:00+02:00') to freeze the reference date.
   */
  it('returns correct Mon–Sun range for a Wednesday in SAST', () => {
    const base = new Date('2026-06-24T10:00:00+02:00');
    const { from, to } = getCurrentSastWeek(base);
    expect(from).toBe('2026-06-22');
    expect(to).toBe('2026-06-28');
  });

  it('handles Monday as the start of the week', () => {
    const base = new Date('2026-06-22T08:00:00+02:00'); // Monday
    const { from, to } = getCurrentSastWeek(base);
    expect(from).toBe('2026-06-22');
    expect(to).toBe('2026-06-28');
  });

  it('handles Sunday as the end of the week', () => {
    const base = new Date('2026-06-28T22:00:00+02:00'); // Sunday
    const { from, to } = getCurrentSastWeek(base);
    expect(from).toBe('2026-06-22');
    expect(to).toBe('2026-06-28');
  });

  it('spans a month boundary correctly', () => {
    // 2026-05-29 (Friday) → week Mon=2026-05-25 … Sun=2026-05-31
    const base = new Date('2026-05-29T12:00:00+02:00');
    const { from, to } = getCurrentSastWeek(base);
    expect(from).toBe('2026-05-25');
    expect(to).toBe('2026-05-31');
  });

  it('spans year boundary correctly', () => {
    // 2025-12-31 is a Wednesday → Mon=2025-12-29 … Sun=2026-01-04
    const base = new Date('2025-12-31T10:00:00+02:00');
    const { from, to } = getCurrentSastWeek(base);
    expect(from).toBe('2025-12-29');
    expect(to).toBe('2026-01-04');
  });

  it('from <= to always', () => {
    const base = new Date('2026-06-20T00:00:00+02:00'); // Saturday
    const { from, to } = getCurrentSastWeek(base);
    expect(new Date(from) <= new Date(to)).toBe(true);
  });
});

// ── formatHours ───────────────────────────────────────────────────────────────

describe('formatHours', () => {
  it('returns "—" for null', () => {
    expect(formatHours(null)).toBe('—');
  });

  it('returns "—" for 0', () => {
    expect(formatHours(0)).toBe('—');
  });

  it('formats whole hours', () => {
    expect(formatHours(8)).toBe('8h');
  });

  it('formats hours + minutes', () => {
    expect(formatHours(8.5)).toBe('8h 30m');
  });

  it('formats minutes only (< 1h)', () => {
    expect(formatHours(0.25)).toBe('0h 15m');
  });

  it('rounds fractional minutes correctly', () => {
    // 7.333... hours = 7h 20m
    expect(formatHours(7 + 20 / 60)).toBe('7h 20m');
  });
});

// ── safeFormatTime ────────────────────────────────────────────────────────────

describe('safeFormatTime', () => {
  it('returns "—" for null', () => {
    expect(safeFormatTime(null)).toBe('—');
  });

  it('returns "—" for undefined', () => {
    expect(safeFormatTime(undefined)).toBe('—');
  });

  it('returns a HH:MM string for a valid ISO timestamp', () => {
    // 2026-06-24T06:00:00Z = 08:00 SAST
    const result = safeFormatTime('2026-06-24T06:00:00.000Z');
    expect(result).toBe('08:00');
  });
});

// ── fromLocalDatetimeValue / toLocalDatetimeValue ─────────────────────────────

describe('fromLocalDatetimeValue', () => {
  it('returns "" for empty string', () => {
    expect(fromLocalDatetimeValue('')).toBe('');
  });

  it('converts a SAST datetime-local value to UTC ISO', () => {
    // 08:00 SAST = 06:00 UTC
    const utc = fromLocalDatetimeValue('2026-06-24T08:00');
    expect(utc).toBe('2026-06-24T06:00:00.000Z');
  });
});

describe('toLocalDatetimeValue', () => {
  it('returns "" for null', () => {
    expect(toLocalDatetimeValue(null)).toBe('');
  });

  it('converts UTC ISO to SAST datetime-local value', () => {
    // 06:00 UTC = 08:00 SAST
    const local = toLocalDatetimeValue('2026-06-24T06:00:00.000Z');
    expect(local).toBe('2026-06-24T08:00');
  });

  it('round-trips: toLocal then fromLocal returns original UTC', () => {
    const original = '2026-06-24T14:30:00.000Z';
    const local = toLocalDatetimeValue(original);
    const backToUtc = fromLocalDatetimeValue(local);
    expect(backToUtc).toBe(original);
  });
});

/**
 * Unit tests for pure helpers in clockUtils — DB-free portions only.
 *
 * `sastWorkDate` is the load-bearing function here: a bug in it would
 * silently misassign offline clock-ins and ruin payroll. All the other
 * exports hit the DB and belong in an integration test.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/db-pool', () => ({ sql: vi.fn() }));

import { sastWorkDate } from '../clockUtils';

describe('sastWorkDate', () => {
  it('returns the SAST calendar date for a UTC midnight instant', () => {
    // 2026-04-20T00:00:00Z → 2026-04-20T02:00:00+02:00 (SAST) — still Apr 20
    expect(sastWorkDate(new Date('2026-04-20T00:00:00Z'))).toBe('2026-04-20');
  });

  it('crosses the UTC date boundary correctly for late-evening SAST', () => {
    // 2026-04-20T23:30:00+02:00 → UTC is 2026-04-20T21:30:00Z — same day SAST
    expect(sastWorkDate(new Date('2026-04-20T21:30:00Z'))).toBe('2026-04-20');
  });

  it('correctly identifies the next SAST day for post-midnight SAST', () => {
    // 2026-04-21T00:30:00+02:00 → UTC is 2026-04-20T22:30:00Z
    // Offline clock-out submitted at 00:30 SAST must belong to Apr 21.
    // Wait — business rule: work_date is fixed at clock-in, so clock-out
    // at 00:30 against a clock-in on Apr 20 STAYS on Apr 20. The helper
    // itself just formats whatever moment it's given — here we verify
    // the timezone conversion.
    expect(sastWorkDate(new Date('2026-04-20T22:30:00Z'))).toBe('2026-04-21');
  });

  it('formats to YYYY-MM-DD with zero-padded month/day', () => {
    expect(sastWorkDate(new Date('2026-01-05T10:00:00Z'))).toBe('2026-01-05');
    expect(sastWorkDate(new Date('2026-12-31T20:00:00Z'))).toBe('2026-12-31');
  });

  it('throws on invalid Date rather than returning "Invalid Date"', () => {
    // Regression guard: a future caller passing `new Date('not a date')`
    // would otherwise format as the literal string "Invalid Date", which
    // the DATE-typed INSERT would reject with an opaque pg error.
    expect(() => sastWorkDate(new Date('not-a-date'))).toThrow(/invalid Date/);
    // @ts-expect-error — runtime guard against non-Date argument
    expect(() => sastWorkDate(null)).toThrow(/invalid Date/);
  });
});

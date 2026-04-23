/**
 * Unit tests for pure helpers in clockUtils — DB-free portions only.
 *
 * `sastWorkDate` is the load-bearing function here: a bug in it would
 * silently misassign offline clock-ins and ruin payroll. All the other
 * exports hit the DB and belong in an integration test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));

import { captureRateAtClockIn, sastWorkDate } from '../clockUtils';

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

describe('captureRateAtClockIn', () => {
  beforeEach(() => {
    mocks.sql.mockReset();
  });

  it('emits the INSERT … SELECT with ON CONFLICT DO NOTHING and NULL-rate skip', async () => {
    mocks.sql.mockResolvedValueOnce([]);
    await captureRateAtClockIn('e-1', 's-1');
    expect(mocks.sql).toHaveBeenCalledOnce();
    const template = mocks.sql.mock.calls[0]![0].join(' ');
    expect(template).toMatch(/INSERT\s+INTO\s+staff_rate_at_clock_in/i);
    expect(template).toMatch(/FROM\s+staff\s+WHERE\s+id\s*=/i);
    // NULL-rate staff are skipped by the WHERE clause, not by a NOT NULL
    // CHECK (which would fail the INSERT loudly).
    expect(template).toMatch(/hourly_rate\s+IS\s+NOT\s+NULL/i);
    // Idempotent: repeat clock-ins on the same entry (shouldn't happen
    // — partial unique index prevents two open entries — but defensive).
    expect(template).toMatch(/ON\s+CONFLICT\s*\(\s*entry_id\s*\)\s+DO\s+NOTHING/i);
  });

  it('parameterises entry_id and staff_id', async () => {
    mocks.sql.mockResolvedValueOnce([]);
    await captureRateAtClockIn('e-1', 's-1');
    const params = mocks.sql.mock.calls[0]!.slice(1);
    expect(params).toContain('e-1');
    expect(params).toContain('s-1');
  });

  it('swallows DB errors (best-effort write — reconcile falls back)', async () => {
    // The snapshot is an audit nice-to-have; failure must NOT propagate
    // so the clock-in itself succeeds. Reconcile will fall back to
    // reading live staff.hourly_rate (the PR #1406 behaviour).
    mocks.sql.mockRejectedValueOnce(new Error('DB offline'));
    await expect(captureRateAtClockIn('e-1', 's-1')).resolves.toBeUndefined();
  });
});

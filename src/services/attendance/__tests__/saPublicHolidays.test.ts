/**
 * Unit tests for saPublicHolidays helpers.
 *
 * `loadObservedHolidays` is the only function here that touches the DB; we
 * mock the `sql` tagged-template to assert the SQL shape + parameter flow
 * without needing a live Postgres connection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: sqlMock }));

import { isHolidayDate, isSunday, loadObservedHolidays } from '../saPublicHolidays';

describe('isSunday', () => {
  it('returns true for a known Sunday in SAST', () => {
    expect(isSunday('2026-04-19')).toBe(true);
  });

  it('returns false for a Monday', () => {
    expect(isSunday('2026-04-20')).toBe(false);
  });

  it('returns false for a Saturday', () => {
    expect(isSunday('2026-04-18')).toBe(false);
  });

  it('throws on malformed date', () => {
    expect(() => isSunday('not-a-date')).toThrow(/YYYY-MM-DD/);
  });
});

describe('isHolidayDate', () => {
  it('true when workDate is in the set', () => {
    const set = new Set(['2026-04-27']);
    expect(isHolidayDate('2026-04-27', set)).toBe(true);
  });

  it('false when workDate is not in the set', () => {
    const set = new Set(['2026-04-27']);
    expect(isHolidayDate('2026-04-28', set)).toBe(false);
  });

  it('false against an empty set', () => {
    expect(isHolidayDate('2026-04-27', new Set())).toBe(false);
  });
});

describe('loadObservedHolidays', () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it('returns a Set of observed-date strings from the DB rows', async () => {
    sqlMock.mockResolvedValueOnce([
      { date: '2026-04-27' },
      { date: '2026-05-01' },
    ]);
    const set = await loadObservedHolidays('2026-04-01', '2026-05-31');
    expect(set.has('2026-04-27')).toBe(true);
    expect(set.has('2026-05-01')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('returns an empty Set when the DB returns no rows', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const set = await loadObservedHolidays('2026-06-01', '2026-06-15');
    expect(set.size).toBe(0);
  });

  it('rejects malformed date arguments', async () => {
    await expect(loadObservedHolidays('not-a-date', '2026-05-31')).rejects.toThrow(
      /YYYY-MM-DD/
    );
    await expect(loadObservedHolidays('2026-04-01', 'also-bad')).rejects.toThrow(
      /YYYY-MM-DD/
    );
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects inverted ranges (from > to)', async () => {
    await expect(loadObservedHolidays('2026-05-31', '2026-04-01')).rejects.toThrow(
      /must be <= toDate/
    );
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('emits a bounded range query with both dates as parameters', async () => {
    // Regression guard: a refactor that drops the WHERE clause would still
    // pass the "returns rows" tests above because the mock ignores SQL.
    // Assert the tagged-template shape so widening-to-all-time dies here.
    sqlMock.mockResolvedValueOnce([]);
    await loadObservedHolidays('2026-04-01', '2026-05-31');

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [strings, ...values] = sqlMock.mock.calls[0] as [
      readonly string[],
      ...unknown[],
    ];
    const joined = strings.join(' ');
    expect(joined).toMatch(/FROM\s+public_holidays/i);
    expect(joined).toMatch(/date\s*>=/i);
    expect(joined).toMatch(/date\s*<=/i);
    expect(values).toEqual(['2026-04-01', '2026-05-31']);
  });
});

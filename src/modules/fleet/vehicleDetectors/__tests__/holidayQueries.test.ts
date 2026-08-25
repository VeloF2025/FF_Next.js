import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: db.query, queryOne: vi.fn(), transaction: vi.fn() }));

import { loadHolidays } from '../holidayQueries';

beforeEach(() => { vi.clearAllMocks(); });

describe('loadHolidays', () => {
  it('returns the observed dates as a set of YYYY-MM-DD strings', async () => {
    db.query.mockResolvedValue([{ holiday_date: '2026-04-27' }, { holiday_date: '2026-05-01' }]);
    const holidays = await loadHolidays('2026-04-01', '2026-05-31');
    expect(holidays).toBeInstanceOf(Set);
    expect([...holidays]).toEqual(['2026-04-27', '2026-05-01']);
    expect(db.query.mock.calls[0]?.[1]).toEqual(['2026-04-01', '2026-05-31']);
  });

  it('formats the date in Postgres, never through the JS Date the driver returns', async () => {
    // node-postgres parses a DATE (OID 1082) at LOCAL midnight, and
    // toISOString() on that reports the day BEFORE in SAST. Formatting with
    // to_char skips the round trip; asserting on the SQL is what stops a later
    // edit from reintroducing it.
    db.query.mockResolvedValue([]);
    await loadHolidays('2026-01-01', '2026-12-31');
    const sql = db.query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("to_char(date, 'YYYY-MM-DD')");
    expect(sql).not.toContain('toISOString');
  });

  it('bounds the scan on both ends rather than loading the whole calendar', async () => {
    db.query.mockResolvedValue([]);
    await loadHolidays('2026-08-01', '2026-08-31');
    const sql = db.query.mock.calls[0]?.[0] as string;
    expect(sql).toContain('date >= $1::date');
    expect(sql).toContain('date <= $2::date');
  });

  it('returns an empty set for a range with no holidays', async () => {
    db.query.mockResolvedValue([]);
    await expect(loadHolidays('2026-02-01', '2026-02-28')).resolves.toEqual(new Set());
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ sql: db.sql, query: vi.fn(), queryOne: vi.fn(), transaction: vi.fn() }));

import { loadHolidays } from '../holidayQueries';
import { loadObservedHolidays } from '@/services/attendance/saPublicHolidays';

beforeEach(() => { vi.clearAllMocks(); });

describe('loadHolidays', () => {
  it('IS the attendance loader, not a second copy of it', () => {
    // A duplicate query is a second place for the DATE/timezone trap to come
    // back and a second place to forget the YYYY-MM-DD validation.
    expect(loadHolidays).toBe(loadObservedHolidays);
  });

  it('returns the observed dates as a set of YYYY-MM-DD strings', async () => {
    db.sql.mockResolvedValue([{ date: '2026-04-27' }, { date: '2026-05-01' }]);
    await expect(loadHolidays('2026-04-01', '2026-05-31')).resolves.toEqual(new Set(['2026-04-27', '2026-05-01']));
  });

  it('formats the date in Postgres, never through the JS Date the driver returns', async () => {
    db.sql.mockResolvedValue([]);
    await loadHolidays('2026-01-01', '2026-12-31');
    expect(db.sql.mock.calls[0]?.[0]?.join('?')).toContain("TO_CHAR(date, 'YYYY-MM-DD')");
  });

  it('returns an empty set for a range with no holidays', async () => {
    db.sql.mockResolvedValue([]);
    await expect(loadHolidays('2026-02-01', '2026-02-28')).resolves.toEqual(new Set());
  });

  it.each(['2026-4-27', 'yesterday', '', '2026-04-27T00:00:00Z'])(
    'refuses the malformed bound %s rather than querying with it', async (bound) => {
      await expect(loadHolidays(bound, '2026-12-31')).rejects.toThrow(/YYYY-MM-DD/);
      expect(db.sql).not.toHaveBeenCalled();
    },
  );

  it('refuses an inverted range', async () => {
    await expect(loadHolidays('2026-12-31', '2026-01-01')).rejects.toThrow(/must be <=/);
    expect(db.sql).not.toHaveBeenCalled();
  });
});

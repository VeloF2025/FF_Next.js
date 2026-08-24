/**
 * Freshness is the line that tells a reader how old the numbers beside it are,
 * so a freshness date that is off by a day is worse than no date: it looks
 * authoritative and is wrong in the direction of understating coverage.
 *
 * `MAX(month_start)` over a DATE column comes back as a local-midnight `Date`,
 * which formats through UTC as the previous day in any positive-offset zone.
 * The fixtures here hand back a real `Date` for that reason.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/db-pool', () => db);

import { latestAggregationRun, listScopedProjectIds } from '../operationsRunQueries';

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  db.query.mockResolvedValue([]);
  db.queryOne.mockResolvedValue(null);
});

describe('freshness', () => {
  it('reports a local-midnight DATE as the month it is, not the day before', async () => {
    db.queryOne.mockResolvedValue({ status: 'succeeded', aggregates_through: new Date(2026, 6, 1) });
    expect((await latestAggregationRun())?.aggregatesThrough).toBe('2026-07-01');
  });

  it('agrees with itself whether the driver hands back a Date or a string', async () => {
    db.queryOne.mockResolvedValueOnce({ status: 'succeeded', aggregates_through: new Date(2024, 2, 1) });
    const fromDate = await latestAggregationRun();
    db.queryOne.mockResolvedValueOnce({ status: 'succeeded', aggregates_through: '2024-03-01' });
    const fromString = await latestAggregationRun();
    expect(fromDate?.aggregatesThrough).toBe(fromString?.aggregatesThrough);
  });

  it('reports null coverage rather than a confident zero when nothing is stored', async () => {
    db.queryOne.mockResolvedValue({ status: 'failed', aggregates_through: null });
    expect(await latestAggregationRun()).toEqual({ status: 'failed', aggregatesThrough: null });
  });

  it('reports nothing at all when the pipeline has never finished a run', async () => {
    expect(await latestAggregationRun()).toBeNull();
  });
});

describe('the projects a viewer manages', () => {
  it('matches on either the user id or the staff id, as the queue does', async () => {
    db.query.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    expect(await listScopedProjectIds({ unrestricted: false, pmUserId: USER, pmStaffId: STAFF }))
      .toEqual(['p1', 'p2']);
    expect(db.query.mock.calls[0]?.[1]).toEqual([USER, STAFF]);
  });

  it('resolves the projects a named manager owns through the same one definition', async () => {
    db.query.mockResolvedValue([{ id: 'p1' }]);
    expect(await listScopedProjectIds({ unrestricted: false, pmUserId: USER, pmStaffId: null }))
      .toEqual(['p1']);
    expect(db.query.mock.calls[0]?.[1]).toEqual([USER, null]);
  });
});

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


/** SAST has no DST, so the offset the driver produced is a constant. */
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

/**
 * A DATE column exactly as node-postgres hands it back from the production
 * server, whose zone is Africa/Johannesburg: a `Date` at LOCAL midnight, whose
 * UTC instant is therefore 22:00 on the PREVIOUS day.
 *
 * The local parts are pinned rather than left to `new Date(y, m, d)`. That
 * expression reproduces the trap only in a zone ahead of UTC — run the suite
 * under `TZ=UTC` and the fixture becomes its own UTC instant, `toISOString()`
 * is accidentally right, and the test passes whatever the code does. Pinning
 * both faces here makes the fixture reproduce production in every zone, so the
 * assertion below fails on a UTC-formatting reader wherever it runs.
 *
 * (`process.env.TZ` cannot do this job: V8 latches the zone when the vitest
 * worker starts and does not re-read the variable afterwards.)
 */
function sastDateColumn(year: number, month: number, day: number): Date {
  const value = new Date(Date.UTC(year, month - 1, day) - SAST_OFFSET_MS);
  return Object.assign(value, {
    getFullYear: () => year,
    getMonth: () => month - 1,
    getDate: () => day,
  });
}

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  db.query.mockResolvedValue([]);
  db.queryOne.mockResolvedValue(null);
});

describe('freshness', () => {
  it('reports coverage for the metric version asked about, not for any version', async () => {
    // Two versions of a month coexist in the table. An unscoped MAX would
    // report coverage from a definition the numbers beside it were not built
    // with, which is a confident line about the wrong thing.
    db.queryOne.mockResolvedValue({ status: 'succeeded', aggregates_through: '2026-07-01' });
    await latestAggregationRun(3);
    expect(db.queryOne.mock.calls[0]?.[1]).toEqual([3]);
    expect(String(db.queryOne.mock.calls[0]?.[0])).toContain('metric_version = $1');
  });

  it('reports a local-midnight DATE as the month it is, not the day before', async () => {
    db.queryOne.mockResolvedValue({ status: 'succeeded', aggregates_through: sastDateColumn(2026, 7, 1) });
    expect((await latestAggregationRun(1))?.aggregatesThrough).toBe('2026-07-01');
  });

  it('agrees with itself whether the driver hands back a Date or a string', async () => {
    db.queryOne.mockResolvedValueOnce({ status: 'succeeded', aggregates_through: sastDateColumn(2024, 3, 1) });
    const fromDate = await latestAggregationRun(1);
    db.queryOne.mockResolvedValueOnce({ status: 'succeeded', aggregates_through: '2024-03-01' });
    const fromString = await latestAggregationRun(1);
    expect(fromDate?.aggregatesThrough).toBe(fromString?.aggregatesThrough);
  });

  it('reports null coverage rather than a confident zero when nothing is stored', async () => {
    db.queryOne.mockResolvedValue({ status: 'failed', aggregates_through: null });
    expect(await latestAggregationRun(1)).toEqual({ status: 'failed', aggregatesThrough: null });
  });

  it('reports nothing at all when the pipeline has never finished a run', async () => {
    expect(await latestAggregationRun(1)).toBeNull();
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

describe('the fixture itself', () => {
  it('has the two faces a driver DATE has: local parts, and an earlier instant', () => {
    // If this ever stops holding, every assertion below is testing nothing.
    const value = sastDateColumn(2024, 3, 1);
    expect([value.getFullYear(), value.getMonth() + 1, value.getDate()]).toEqual([2024, 3, 1]);
    expect(value.toISOString()).toBe('2024-02-29T22:00:00.000Z');
  });
});

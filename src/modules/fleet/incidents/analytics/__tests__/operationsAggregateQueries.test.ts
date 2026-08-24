/**
 * The published-aggregate reader, at the two places it can quietly lie.
 *
 * The first is the date. `month_start` is a DATE column, and node-postgres
 * parses a DATE into a JS `Date` at LOCAL midnight — so in SAST the driver
 * hands back `2024-03-01T00:00:00+02:00`, whose `toISOString()` is
 * `2024-02-29T22:00:00Z`. A reader that formats through UTC therefore reports
 * March's figures under February's key, the caller's lookup misses, and the
 * month renders empty while the suppression notices still describe it. Every
 * fixture here hands back a real `Date`, because a string fixture exercises the
 * branch that was never wrong.
 *
 * The second is scope: which statement runs, and with which parameters.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/db-pool', () => db);

import { readPublishedAggregates } from '../operationsAggregateQueries';

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const OTHER_PROJECT = '44444444-4444-4444-8444-444444444444';
const SITE = '55555555-5555-4555-8555-555555555555';

const restricted = { unrestricted: false, pmUserId: USER, pmStaffId: STAFF };
const unrestricted = { unrestricted: true, pmUserId: USER, pmStaffId: null };

/**
 * A row as the driver actually returns one: `month_start` is a `Date` at LOCAL
 * midnight, not the `YYYY-MM-DD` string the rest of the module passes around.
 */
function row(overrides: Record<string, unknown> = {}) {
  return {
    month_start: new Date(2024, 2, 1),
    dimension_project_id: PROJECT,
    metric_key: 'incident.late',
    numerator: 7,
    denominator: 20,
    sample_count: null,
    sum_seconds: null,
    generalized_from_level: null,
    bucket_0_300: null, bucket_301_900: null, bucket_901_1800: null,
    bucket_1801_3600: null, bucket_3601_14400: null, bucket_over_14400: null,
    ...overrides,
  };
}

const request = { monthStarts: ['2024-03-01'], metricVersion: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  db.query.mockResolvedValue([row()]);
});

describe('the month a row belongs to', () => {
  it('reads a local-midnight DATE as the calendar month it is, not the day before', async () => {
    const [aggregate] = await readPublishedAggregates(request, unrestricted);
    expect(aggregate?.monthStart).toBe('2024-03-01');
  });

  it('reports the same month for the string and Date forms of the same date', async () => {
    db.query.mockResolvedValueOnce([row()]);
    const [fromDate] = await readPublishedAggregates(request, unrestricted);
    db.query.mockResolvedValueOnce([row({ month_start: '2024-03-01' })]);
    const [fromString] = await readPublishedAggregates(request, unrestricted);
    expect(fromDate?.monthStart).toBe(fromString?.monthStart);
  });

  it('reads January of the following year rather than the last day of December', async () => {
    db.query.mockResolvedValue([row({ month_start: new Date(2025, 0, 1) })]);
    const [aggregate] = await readPublishedAggregates(request, unrestricted);
    expect(aggregate?.monthStart).toBe('2025-01-01');
  });
});

describe('which statement runs', () => {
  it('asks for nothing at all when no month was requested', async () => {
    expect(await readPublishedAggregates({ ...request, monthStarts: [] }, unrestricted)).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('reads the organisation row only for an unrestricted viewer with no filter', async () => {
    await readPublishedAggregates(request, unrestricted);
    expect(db.query.mock.calls[0]?.[0]).toContain('aggregates-organisation');
  });

  it('reads the managed project rows for a restricted viewer with no filter', async () => {
    await readPublishedAggregates(request, restricted);
    expect(db.query.mock.calls[0]?.[0]).toContain('aggregates-managed-projects');
    expect(db.query.mock.calls[0]?.[1]).toEqual([['2024-03-01'], 1, USER, STAFF]);
  });

  it('binds the site id last, after the scope parameters, when scoped', async () => {
    await readPublishedAggregates({ ...request, operationalSiteId: SITE }, restricted);
    expect(db.query.mock.calls[0]?.[1]).toEqual([['2024-03-01'], 1, USER, STAFF, SITE]);
  });

  it('binds the site id immediately after the base parameters when unrestricted', async () => {
    await readPublishedAggregates({ ...request, operationalSiteId: SITE }, unrestricted);
    expect(db.query.mock.calls[0]?.[1]).toEqual([['2024-03-01'], 1, SITE]);
  });

  it('restricts to a manager project list when one is given', async () => {
    await readPublishedAggregates({ ...request, projectIds: [PROJECT, OTHER_PROJECT] }, unrestricted);
    expect(db.query.mock.calls[0]?.[0]).toContain('aggregates-project-list');
    expect(db.query.mock.calls[0]?.[1]).toEqual([['2024-03-01'], 1, [PROJECT, OTHER_PROJECT]]);
  });

  it('never reaches past the published view', async () => {
    await readPublishedAggregates(request, restricted);
    const sql = String(db.query.mock.calls[0]?.[0]);
    expect(sql).toContain('fleet_operational_monthly_aggregates_published');
  });
});

describe('what a row carries back', () => {
  it('names the project a row is about, so a caller can tell which are missing', async () => {
    const [aggregate] = await readPublishedAggregates(request, restricted);
    expect(aggregate?.dimensionProjectId).toBe(PROJECT);
  });

  it('marks a row generalized when it stood in for a level below it', async () => {
    db.query.mockResolvedValue([row({ generalized_from_level: 'site' })]);
    const [aggregate] = await readPublishedAggregates(request, unrestricted);
    expect(aggregate?.generalized).toBe(true);
  });
});

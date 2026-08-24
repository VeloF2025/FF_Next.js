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
 * The second is scope: which statement runs, and with which parameters. There
 * is no site statement — migration 527 publishes organisation and project rows
 * only — and no histogram, contributor-count or generalized column to read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/db-pool', () => db);

import { PUBLISHED_VIEW_COLUMNS } from '../aggregateSchema';
import { readPublishedAggregates } from '../operationsAggregateQueries';

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const OTHER_PROJECT = '44444444-4444-4444-8444-444444444444';


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

const restricted = { unrestricted: false, pmUserId: USER, pmStaffId: STAFF };
const unrestricted = { unrestricted: true, pmUserId: USER, pmStaffId: null };

/**
 * A row as the driver actually returns one: `month_start` is a `Date` at LOCAL
 * midnight, not the `YYYY-MM-DD` string the rest of the module passes around.
 */
function row(overrides: Record<string, unknown> = {}) {
  return {
    month_start: sastDateColumn(2024, 3, 1),
    dimension_project_id: PROJECT,
    metric_key: 'incident.late',
    numerator: 7,
    denominator: 20,
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
    db.query.mockResolvedValue([row({ month_start: sastDateColumn(2025, 1, 1) })]);
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

  it('reads a TOTAL_ONLY row as a total with no population to divide by', async () => {
    // The tier publishes the component's root and nothing else, so there is no
    // breakdown and no denominator. Null, never zero: zero would divide.
    db.query.mockResolvedValue([row({ metric_key: 'presence.scheduled_days', numerator: 20, denominator: null })]);
    const [aggregate] = await readPublishedAggregates(request, unrestricted);
    expect(aggregate).toEqual({
      monthStart: '2024-03-01', dimensionProjectId: PROJECT,
      metricKey: 'presence.scheduled_days', numerator: 20, denominator: null,
    });
  });

  it('carries no histogram, contributor count, or generalized flag', async () => {
    // They are not columns of the view. A read path that reached for one would
    // get undefined and quietly report it as a shape the caller trusts.
    const [aggregate] = await readPublishedAggregates(request, unrestricted);
    expect(Object.keys(aggregate ?? {}).sort())
      .toEqual(['denominator', 'dimensionProjectId', 'metricKey', 'monthStart', 'numerator']);
  });

  it('selects no column the published view does not have', async () => {
    await readPublishedAggregates(request, unrestricted);
    const sql = String(db.query.mock.calls[0]?.[0]);
    for (const gone of ['contributor_count', 'sample_count', 'sum_seconds', 'bucket_', 'generalized_from_level']) {
      expect(sql).not.toContain(gone);
    }
  });

  it('never reads a site row, because none is published', async () => {
    for (const scope of [unrestricted, restricted]) {
      vi.clearAllMocks();
      db.query.mockResolvedValue([row()]);
      await readPublishedAggregates(request, scope);
      const sql = String(db.query.mock.calls[0]?.[0]);
      expect(sql).not.toContain("dimension_level = 'site'");
      expect(sql).not.toContain('dimension_site_id');
    }
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

describe('placeholders and binds, for every branch', () => {
  /** The highest `$n` the statement references. */
  function highestPlaceholder(sql: string): number {
    const found = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
    return found.length === 0 ? 0 : Math.max(...found);
  }

  const branches: Array<[string, Parameters<typeof readPublishedAggregates>[0]]> = [
    ['organisation / managed projects', request],
    ['one project', { ...request, projectId: PROJECT }],
    ['a manager project list', { ...request, projectIds: [PROJECT, OTHER_PROJECT] }],
  ];

  for (const [name, dimensions] of branches) {
    it.each([['unrestricted', unrestricted], ['scoped', restricted]])(
      `binds exactly as many parameters as the %s ${name} statement references`,
      async (_kind, scope) => {
        // A branch whose SQL says $3 while its caller binds the value fifth
        // does not fail at build time and does not fail in review. Postgres
        // rejects it at bind time, for that viewer, on that branch alone.
        vi.clearAllMocks();
        db.query.mockResolvedValue([row()]);
        await readPublishedAggregates(dimensions, scope);
        const sql = String(db.query.mock.calls[0]?.[0]);
        const params = (db.query.mock.calls[0]?.[1] ?? []) as unknown[];
        expect(highestPlaceholder(sql)).toBe(params.length);
      },
    );
  }

  it('spends $3 and $4 on the scope predicate, so a branch parameter starts at $5', async () => {
    await readPublishedAggregates({ ...request, projectId: PROJECT }, restricted);
    const sql = String(db.query.mock.calls[0]?.[0]);
    expect(sql).toContain('p.project_manager = $3::uuid');
    expect(sql).toContain('p.project_manager = $4::uuid');
    expect(sql).toContain('a.dimension_project_id = $5::uuid');
  });

  it('spends nothing on scope when unrestricted, so a branch parameter starts at $3', async () => {
    await readPublishedAggregates({ ...request, projectId: PROJECT }, unrestricted);
    const sql = String(db.query.mock.calls[0]?.[0]);
    expect(sql).not.toContain('project_manager');
    expect(sql).toContain('a.dimension_project_id = $3::uuid');
  });
});

describe('the columns this file is allowed to name', () => {
  /**
   * Every column the statement asks the view for, from its SELECT list.
   *
   * Read from the SQL that is actually sent rather than from the constant that
   * builds it: a column appended anywhere else in the SELECT would satisfy a
   * test that only inspected the constant, and Postgres does not care which
   * half of the string it came from.
   */
  function selectedColumns(sql: string): string[] {
    const select = sql.slice(sql.indexOf('SELECT ') + 'SELECT '.length, sql.indexOf(' FROM '));
    return select.split(',').map((column) => column.trim()).filter((column) => column.length > 0);
  }

  /** Every column referenced through the view's own alias, WHERE clause included. */
  function aliasedColumns(sql: string): string[] {
    return [...new Set([...sql.matchAll(/\ba\.([a-z_]+)/g)].map((match) => match[1] as string))];
  }

  const requests: Array<[string, Parameters<typeof readPublishedAggregates>[0]]> = [
    ['organisation / managed projects', request],
    ['one project', { ...request, projectId: PROJECT }],
    ['a manager project list', { ...request, projectIds: [PROJECT, OTHER_PROJECT] }],
  ];

  for (const [name, dimensions] of requests) {
    it.each([['unrestricted', unrestricted], ['scoped', restricted]])(
      `selects only published columns on the %s ${name} statement`,
      async (_kind, scope) => {
        // The view is a moving target: it has already lost contributor_count,
        // the histogram columns, generalized_from_level and checksum. Selecting
        // a column it no longer has is not a type error and not a review
        // finding — it is a 500 for whichever viewer reaches that branch.
        vi.clearAllMocks();
        db.query.mockResolvedValue([row()]);
        await readPublishedAggregates(dimensions, scope);
        const sql = String(db.query.mock.calls[0]?.[0]);
        for (const column of selectedColumns(sql)) {
          expect(PUBLISHED_VIEW_COLUMNS).toContain(column);
        }
      },
    );

    it.each([['unrestricted', unrestricted], ['scoped', restricted]])(
      `filters on only published columns on the %s ${name} statement`,
      async (_kind, scope) => {
        vi.clearAllMocks();
        db.query.mockResolvedValue([row()]);
        await readPublishedAggregates(dimensions, scope);
        for (const column of aliasedColumns(String(db.query.mock.calls[0]?.[0]))) {
          expect(PUBLISHED_VIEW_COLUMNS).toContain(column);
        }
      },
    );
  }

  it('reads at least the five fields a value is built from', () => {
    // The other direction: a subset check alone is satisfied by selecting
    // nothing at all.
    for (const column of ['month_start', 'dimension_project_id', 'metric_key', 'numerator', 'denominator']) {
      expect(PUBLISHED_VIEW_COLUMNS).toContain(column);
    }
  });
});

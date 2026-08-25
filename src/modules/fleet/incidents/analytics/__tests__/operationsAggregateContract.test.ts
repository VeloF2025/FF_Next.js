/**
 * The contract between this reader and migration 527's view.
 *
 * The view is a moving target — it has already lost `contributor_count`, the
 * histogram columns, `generalized_from_level` and `checksum` across three
 * revisions — and every test that mocks the driver is blind to that by
 * construction. These are the tests that are not: they read the SQL actually
 * sent, and the fixtures answer it the way the view would.
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

const restricted = { unrestricted: false, pmUserId: USER, pmStaffId: STAFF };
const unrestricted = { unrestricted: true, pmUserId: USER, pmStaffId: null };

function row(overrides: Record<string, unknown> = {}) {
  return {
    month_start: '2024-03-01',
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

describe('the organisation branch reads the organisation row, and only that', () => {
  /**
   * The levels a statement actually admits, read from its own SQL.
   *
   * This is what makes the mock below faithful rather than obliging: a mock
   * that hands back whatever it was told to, regardless of the WHERE clause,
   * agrees with a statement that selects the wrong level just as readily as
   * with one that selects the right one.
   */
  function levelsAdmittedBy(sql: string): string[] {
    const single = /dimension_level = '(\w+)'/.exec(sql);
    if (single?.[1] !== undefined) return [single[1]];
    const many = /dimension_level = ANY\(ARRAY\[([^\]]+)\]\)/.exec(sql);
    if (many?.[1] !== undefined) return many[1].split(',').map((level) => level.trim().replace(/'/g, ''));
    return [];
  }

  const ORGANISATION_ROW = row({ dimension_level: 'organisation', dimension_project_id: null, numerator: 100 });
  const PROJECT_ROWS = [
    row({ dimension_level: 'project', dimension_project_id: PROJECT, numerator: 7 }),
    row({ dimension_level: 'project', dimension_project_id: OTHER_PROJECT, numerator: 9 }),
  ];

  beforeEach(() => {
    db.query.mockImplementation(async (sql: unknown) => {
      const levels = levelsAdmittedBy(String(sql));
      return [ORGANISATION_ROW, ...PROJECT_ROWS]
        .filter((candidate) => levels.length === 0 || levels.includes(String(candidate.dimension_level)));
    });
  });

  it('pins the predicate itself, not just the branch tag', async () => {
    await readPublishedAggregates(request, unrestricted);
    expect(String(db.query.mock.calls[0]?.[0])).toContain("a.dimension_level = 'organisation'");
  });

  it('folds the organisation row and none of the project rows', async () => {
    // The organisation row is not the sum of the projects: under the tier rule
    // it publishes over the projects it leaves behind. Folding both would
    // double-count everything the organisation already covers.
    const aggregates = await readPublishedAggregates(request, unrestricted);
    expect(aggregates).toHaveLength(1);
    expect(aggregates[0]).toMatchObject({ dimensionProjectId: null, numerator: 100 });
  });

  it('reads project rows and no organisation row on the scoped branch', async () => {
    const aggregates = await readPublishedAggregates(request, restricted);
    expect(aggregates.map((aggregate) => aggregate.numerator).sort()).toEqual([7, 9]);
    expect(aggregates.every((aggregate) => aggregate.dimensionProjectId !== null)).toBe(true);
  });
});

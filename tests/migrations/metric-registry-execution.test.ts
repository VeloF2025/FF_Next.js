/**
 * Execution test for the metric registry — real SQL against a real Postgres.
 *
 * Unit tests assert on the SQL *text* the builder emits, which is structurally
 * blind to everything Postgres decides at parse time and at grouping time. Two
 * classes of bug live in that blind spot, and both are silent:
 *
 *   1. A definition whose `from`/`measure`/`dateColumn` does not match the real
 *      schema. That surfaces as a 500 at request time, not at build time — the
 *      42P08 class that once shipped past green CI and five reviewers.
 *
 *   2. GROUP BY resolving a dimension alias to the RAW input column instead of
 *      the canonicalised expression, splitting one project across several rows
 *      that all carry the SAME label. That does not error at all; it just
 *      under-reports. See `groups a canonicalised dimension into ONE row` below.
 *
 * Why a scratch schema rather than the live database: this suite is explicitly
 * forbidden from touching the shared dev+prod DB (see the CI job comment), and
 * the seeded container has none of the three metric source tables. So the tables
 * are created here with the live column types (measured 2026-08-02 against
 * `information_schema.columns`) and seeded with rows chosen to exercise the two
 * failure modes above. Every metric is then run for every grain x dimension it
 * declares — so a metric added to the registry is covered here automatically.
 *
 * The seeded uptake figures are the REAL measured July 2026 weekly totals, so the
 * additivity assertion below is the same number a reviewer can reproduce against
 * production, not an invented one.
 *
 * SAFETY: everything is created in a scratch schema dropped in afterAll. The
 * schema name is deliberately not `mig<N>_scratch` — those are keyed by migration
 * number, and two tests sharing a number would share a schema.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
      'See .env.local.example.'
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { METRICS, findMetric } from '@/modules/metrics/registry';
import { buildMetricQuery } from '@/modules/metrics/registry/queryBuilder';
// From ./series, NOT ./execute: ES imports are hoisted above the DATABASE_URL
// assignment above, and execute.ts builds a pool at module scope (lib/db.mjs
// throws at import when DATABASE_URL is unset). These are the same functions —
// execute.ts imports and re-exports them.
import { toSeries, summarise } from '@/modules/metrics/registry/series';

const SCHEMA = 'metric_registry_scratch';
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const CANONICAL_FN = readFileSync(
  join(SQL_DIR, '477_conformed_project_dimension.sql'),
  'utf8'
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

/** Run inside the scratch schema so the metrics' unqualified table names resolve to it. */
async function scoped<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    // Pin the timezone exactly as executeMetric does, so date_trunc and the
    // half-open range resolve against the same clock the API uses.
    await client.query("SET TIME ZONE 'Africa/Johannesburg'");
    const r = await client.query(sql, params);
    return (r.rows ?? []) as T[];
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  await scoped(
    `CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz DEFAULT NOW())`
  );
  // canonical_project() is what the `project` dimension expression calls.
  await scoped(CANONICAL_FN);

  // Column types mirror production exactly (information_schema, 2026-08-02).
  await scoped(`
    CREATE TABLE project_weekly_zone_pon_uptake (
      week_ending  date,
      project_name character varying(100),
      zone_no      integer,
      installed    integer
    )`);
  await scoped(`
    CREATE TABLE dr_photo_unified_reviews (
      drop_number      character varying(50),
      project          character varying(100),
      created_at       timestamptz,
      wa_received_at   timestamptz,
      installer_name   character varying(255),
      oes_activated_at timestamptz
    )`);
  await scoped(`
    CREATE TABLE metric_snapshots (
      id          bigserial PRIMARY KEY,
      source_key  text NOT NULL,
      as_of_date  date NOT NULL,
      entity_id   text NOT NULL,
      dims        jsonb NOT NULL,
      measures    jsonb NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT NOW()
    )`);

  // ── zone_uptake ───────────────────────────────────────────────────────────
  // `installed` is CUMULATIVE. These four weekly figures are the REAL July 2026
  // totals measured on production: 21,666 -> 22,556 -> 23,342 -> 23,732. They sum
  // to 91,296, which is the wrong answer a naive sum produces.
  await scoped(`
    INSERT INTO project_weekly_zone_pon_uptake (week_ending, project_name, zone_no, installed)
    VALUES ('2026-07-03','Lawley',1,21666),
           ('2026-07-10','Lawley',1,22556),
           ('2026-07-17','Lawley',1,23342),
           ('2026-07-24','Lawley',1,23732)`);

  // ── install_activation_gap ────────────────────────────────────────────────
  // Two raw project spellings that BOTH canonicalise to 'Thembisa POP 1'. This is
  // not hypothetical: production's dr_photo_unified_reviews holds exactly this
  // pair ('TEM' and 'Thembisa POP 1'), and it is what makes the GROUP BY bug
  // observable. Both rows fall in the same month.
  await scoped(`
    INSERT INTO dr_photo_unified_reviews
      (drop_number, project, created_at, wa_received_at, installer_name, oes_activated_at)
    VALUES ('DR001','TEM',            '2026-07-05T09:00:00Z','2026-07-05T09:00:00Z', NULL,      NULL),
           ('DR002','Thembisa POP 1', '2026-07-06T09:00:00Z','2026-07-06T09:00:00Z', NULL,      NULL),
           ('DR003','Lawley',         '2026-07-07T09:00:00Z', NULL,                  'Installer A', NULL),
           -- Activated: must be excluded by the definition's own predicate.
           ('DR004','Lawley',         '2026-07-08T09:00:00Z','2026-07-08T09:00:00Z', NULL,      '2026-07-09T09:00:00Z'),
           -- Neither WA nor a 1Map installer: not an install, must be excluded.
           ('DR005','Lawley',         '2026-07-09T09:00:00Z', NULL,                  NULL,      NULL),
           -- Last instant of the final day: only a HALF-OPEN upper bound keeps it.
           ('DR006','Lawley',         '2026-07-31T23:59:00+02','2026-07-31T23:59:00+02', NULL,  NULL)`);

  // ── pp_open_balance ───────────────────────────────────────────────────────
  // A nightly STOCK. PP-1 is open on both nights, so summing the two days would
  // count it twice. Night 2 is the latest and holds 2 entities.
  await scoped(`
    INSERT INTO metric_snapshots (source_key, as_of_date, entity_id, dims, measures)
    VALUES ('pp_open','2026-07-30','PP-1','{"project":"TEM","olt_name":"tem.olt.01"}','{"age_days":10}'),
           ('pp_open','2026-07-31','PP-1','{"project":"TEM","olt_name":"tem.olt.01"}','{"age_days":11}'),
           ('pp_open','2026-07-31','PP-2','{"project":"Lawley","olt_name":"law.olt.01"}','{"age_days":3}'),
           -- A different source must not leak into this metric.
           ('tickets_open','2026-07-31','T-1','{"project":"Lawley"}','{"age_days":1}')`);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.end();
});

const RANGE = { from: '2026-07-01', to: '2026-07-31' };

describe('every registered metric executes against a real schema', () => {
  for (const def of METRICS) {
    it(`${def.key} runs for each declared grain and dimension`, async () => {
      let ran = 0;
      for (const grain of def.grains) {
        // No dimensions, then each declared dimension on its own, then all together.
        const combos: string[][] = [[], ...def.dimensions.map((d) => [d]), [...def.dimensions]];
        for (const dimensions of combos) {
          const { sql, params } = buildMetricQuery(def, { ...RANGE, grain, dimensions });
          const rows = await scoped(sql, params);
          expect(Array.isArray(rows)).toBe(true);
          ran++;
        }
      }
      // Guards the loop itself: a metric that declared no grains would otherwise
      // "pass" having executed nothing.
      expect(ran).toBeGreaterThan(0);
    });
  }
});

describe('grouping is by expression, not by output alias', () => {
  it('groups a canonicalised dimension into ONE row per period', async () => {
    // ⚠️ The regression this file exists for. 'TEM' and 'Thembisa POP 1' are two
    // raw spellings of one project. Grouping by the ALIAS `project` makes
    // PostgreSQL group by the raw src.project (input columns outrank output
    // aliases in GROUP BY), producing two rows that BOTH read 'Thembisa POP 1'
    // with the count split 1/1 instead of one row with 2. Nothing errors.
    const def = findMetric('install_activation_gap')!;
    const { sql, params } = buildMetricQuery(def, {
      ...RANGE,
      grain: 'month',
      dimensions: ['project'],
    });
    const rows = await scoped(sql, params);
    const series = toSeries(rows, ['project']);

    const thembisa = series.filter((p) => p.dimensions.project === 'Thembisa POP 1');
    expect(thembisa).toHaveLength(1);
    expect(thembisa[0]!.value).toBe(2);

    // Stated as an invariant too, so any future dimension is covered: no two rows
    // may share the same (period, dimension values).
    const keys = series.map((p) => `${p.period}|${JSON.stringify(p.dimensions)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('additivity decides the headline number', () => {
  it('reports the LAST week for a cumulative metric, not the sum of weeks', async () => {
    // The single assertion this whole field exists for. The seeded weeks are the
    // real July 2026 production figures: 21,666 / 22,556 / 23,342 / 23,732.
    const def = findMetric('zone_uptake')!;
    const { sql, params } = buildMetricQuery(def, { ...RANGE, grain: 'week', dimensions: [] });
    const rows = await scoped(sql, params);
    const series = toSeries(rows, []);
    expect(series.map((p) => p.value)).toEqual([21666, 22556, 23342, 23732]);

    const { total, totalPeriod } = summarise(def, series);
    expect(total).toBe(23732);
    expect(total).not.toBe(91296); // the sum — the wrong answer, spelled out
    expect(totalPeriod).toBe('2026-07-20'); // date_trunc('week') → the Monday
  });

  it('sums freely for an additive metric', async () => {
    const def = findMetric('install_activation_gap')!;
    const { sql, params } = buildMetricQuery(def, { ...RANGE, grain: 'day', dimensions: [] });
    const rows = await scoped(sql, params);
    const { total, totalPeriod } = summarise(def, toSeries(rows, []));
    // DR001, DR002, DR003, DR006. DR004 is activated and DR005 was never
    // installed, so both are excluded by the definition's own predicate.
    expect(total).toBe(4);
    expect(totalPeriod).toBeNull();
  });

  it('counts a nightly stock once, at the latest night', async () => {
    const def = findMetric('pp_open_balance')!;
    const { sql, params } = buildMetricQuery(def, {
      from: '2026-07-30',
      to: '2026-07-31',
      grain: 'day',
      dimensions: [],
    });
    const rows = await scoped(sql, params);
    const series = toSeries(rows, []);
    // Both nights are present in the series...
    expect(series.map((p) => p.period)).toEqual(['2026-07-30', '2026-07-31']);
    const { total, totalPeriod } = summarise(def, series);
    // ...but the total is the latest night alone (2 entities), NOT 1 + 2 = 3,
    // which would count PP-1 twice for being open on two nights.
    expect(total).toBe(2);
    expect(totalPeriod).toBe('2026-07-31');
  });
});

describe('date bounds and period rendering', () => {
  it('includes rows landing on the final day of the range', async () => {
    // DR006 is at 23:59 SAST on the `to` date. BETWEEN would resolve the upper
    // bound to midnight and silently drop it; the half-open bound keeps it.
    const def = findMetric('install_activation_gap')!;
    const { sql, params } = buildMetricQuery(def, { ...RANGE, grain: 'day', dimensions: [] });
    const rows = await scoped(sql, params);
    const periods = toSeries(rows, []).map((p) => p.period);
    expect(periods).toContain('2026-07-31');
  });

  it('renders period as an ISO string, never a stringified Date', async () => {
    // `String(pgDate).slice(0,10)` yields "Mon Jul 21". to_char is what stops it.
    const def = findMetric('zone_uptake')!;
    const { sql, params } = buildMetricQuery(def, { ...RANGE, grain: 'week', dimensions: [] });
    const rows = await scoped(sql, params);
    for (const point of toSeries(rows, [])) {
      expect(typeof point.period).toBe('string');
      expect(point.period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('returns a numeric dimension as a string, matching the declared type', async () => {
    // zone_no is INTEGER and node-postgres marshals it to a JS number, so without
    // the String() coercion in toSeries the response would carry `"zone": 1` while
    // MetricSeriesPoint declares `Record<string, string | null>`. This is the only
    // registered dimension whose source column is not already text, so it is the
    // only one that exercises that coercion.
    const def = findMetric('zone_uptake')!;
    const { sql, params } = buildMetricQuery(def, {
      ...RANGE,
      grain: 'week',
      dimensions: ['zone'],
    });
    const rows = await scoped(sql, params);
    const series = toSeries(rows, ['zone']);
    expect(series.length).toBeGreaterThan(0);
    for (const point of series) expect(point.dimensions.zone).toBe('1');
  });

  it('reads only its own snapshot source', async () => {
    // A tickets_open row shares the date and project; the definition's
    // source_key filter is the only thing keeping it out.
    const def = findMetric('pp_open_balance')!;
    const { sql, params } = buildMetricQuery(def, {
      from: '2026-07-31',
      to: '2026-07-31',
      grain: 'day',
      dimensions: [],
    });
    const rows = await scoped(sql, params);
    expect(summarise(def, toSeries(rows, [])).total).toBe(2);
  });
});

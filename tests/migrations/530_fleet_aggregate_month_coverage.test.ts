/**
 * Contract for migration 530 (the aggregate month coverage table), against real
 * Postgres — and the first execution of the writer that fills it.
 *
 * Two things are asserted here that a unit test structurally cannot.
 *
 * THE DDL. A table whose rows authorise deletion is only worth as much as the
 * constraints on it. The GRANT is what decides whether the nightly job can
 * write a coverage row at all, and a superuser-only probe proves nothing about
 * it — so every privilege here is exercised under `SET ROLE fibreflow_user`.
 * The primary key, the month CHECK and the run foreign key are each driven to
 * REJECTION rather than read out of the catalog, because a constraint that is
 * present and unreachable is the same as no constraint.
 *
 * THE WRITE. `replaceMonth`'s coverage upsert was, until this file, only ever
 * observed through a mock that records SQL text. Postgres decides at parse time
 * whether an `ON CONFLICT` target matches a real constraint — a mismatch is
 * 42P10, which a stub client cannot produce and every unit test would sail
 * past. It is driven here across two nights, which is when the upsert matters:
 * the nightly job re-aggregates its whole recalculation window, so night two
 * writes the same key night one did.
 *
 * SAFETY / ISOLATION: scratch schema, application pool pointed at it via
 * `options=-c search_path=...`. Nothing here can reach the shared database.
 */
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

const SCHEMA = 'mig530_aggregate_coverage_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
process.env.DATABASE_URL = SCOPED_URL;

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import type { ReleasedAggregate } from '@/modules/fleet/incidents/analytics/suppression';

const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const INCIDENTS = readFileSync(join(SQL_DIR, '510_fleet_operational_incidents.sql'), 'utf8');
const DRIVER_INPUT = readFileSync(join(SQL_DIR, '511_fleet_incident_driver_input.sql'), 'utf8');
const RETENTION = readFileSync(join(SQL_DIR, '518_fleet_operational_analytics_retention.sql'), 'utf8');
const FORWARD = readFileSync(join(SQL_DIR, '530_fleet_aggregate_month_coverage.sql'), 'utf8');
const ROLLBACK = readFileSync(join(SQL_DIR, 'rollback_530_fleet_aggregate_month_coverage.sql'), 'utf8');

const TABLE = 'fleet_operational_aggregate_month_coverage';
const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const SITE = '44444444-4444-4444-8444-444444444444';

/**
 * Everything 510, 511 and 518 expect to already exist. Column names, types and
 * lengths mirror production; a fixture may declare a SUBSET of production's
 * columns, never a re-typing of one.
 */
const PREREQUISITES = `
  CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE users (id UUID PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE);
  CREATE TABLE staff (
    id UUID PRIMARY KEY, first_name VARCHAR(100) NOT NULL, last_name VARCHAR(100) NOT NULL
  );
  CREATE TABLE projects (id UUID PRIMARY KEY, project_name VARCHAR(255) NOT NULL);
  CREATE TABLE fleet_vehicles (id UUID PRIMARY KEY, registration VARCHAR(20) NOT NULL);
  CREATE TABLE fleet_project_operational_sites (id UUID PRIMARY KEY);
  CREATE TABLE fleet_operational_status_rules (id UUID PRIMARY KEY);
  CREATE TABLE fleet_operational_assignments (id UUID PRIMARY KEY);
  CREATE TABLE attendance_adjustments (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE access_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), type VARCHAR(20) NOT NULL, key VARCHAR(100) UNIQUE NOT NULL,
    parent_key VARCHAR(100), label VARCHAR(100) NOT NULL, description TEXT, route VARCHAR(200),
    sort_order INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT TRUE
  );
  CREATE TABLE role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), role VARCHAR(50) NOT NULL,
    permission_key VARCHAR(100) NOT NULL REFERENCES access_permissions(key) ON DELETE CASCADE,
    actions JSONB NOT NULL, UNIQUE (role, permission_key)
  );
  CREATE TABLE user_permission_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id),
    permission_key VARCHAR(100) NOT NULL, override_type VARCHAR(10) NOT NULL, actions JSONB NOT NULL,
    UNIQUE (user_id, permission_key)
  );
  INSERT INTO users (id, email) VALUES ('${USER}', 'migration-530@example.test');
  INSERT INTO staff (id, first_name, last_name) VALUES ('${STAFF}', 'Migration', 'Test Staff');
  INSERT INTO projects (id, project_name) VALUES ('${PROJECT}', 'Migration Test Project');
  INSERT INTO fleet_project_operational_sites (id) VALUES ('${SITE}');
  INSERT INTO access_permissions (type, key, label) VALUES ('module', 'fleet', 'Fleet');
`;

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 2 });

type Aggregates = typeof import('@/modules/fleet/incidents/analytics/aggregateRepository');
let aggregates: Aggregates;

/**
 * Runs a statement as `fibreflow_user`, which is what the application actually
 * connects as. `SET LOCAL` inside a transaction so the role reverts with the
 * rollback and one case cannot leak its identity into the next.
 */
async function asAppRole<T>(work: (run: (sql: string, params?: unknown[]) => Promise<unknown>) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE fibreflow_user');
    return await work((sql, params) => client.query(sql, params as never[]));
  } finally {
    await client.query('ROLLBACK').catch(() => { /* the connection is being released either way */ });
    client.release();
  }
}

async function seedRun(metricVersion = 1): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO fleet_operational_aggregation_runs (status, metric_version, months_requested, finished_at)
     VALUES ('succeeded', $1, 1, now()) RETURNING id`,
    [metricVersion],
  );
  return rows[0]!.id;
}

/**
 * One releasable aggregate, as the calculator would hand it to `replaceMonth`.
 * `metricKey` is a parameter because the aggregates table's slot index is
 * unique per (version, month, level, project, site, metric) — two rows for one
 * month have to differ somewhere.
 */
function releasedRow(
  monthStart: string, metricVersion: number, metricKey: ReleasedAggregate['metricKey'] = 'incident.late',
): ReleasedAggregate {
  return {
    monthStart, metricVersion, dimensionLevel: 'project', dimensionProjectId: PROJECT,
    dimensionSiteId: null, metricKey, metricKind: 'count',
    numerator: 4, denominator: null, histogram: null, contributorCount: 6,
  };
}

interface CoverageRow extends Record<string, unknown> {
  metric_version: number; month_start: Date; aggregation_run_id: string; row_count: number;
}

async function coverageRows(): Promise<CoverageRow[]> {
  const { rows } = await db.query<CoverageRow>(
    `SELECT metric_version, month_start, aggregation_run_id, row_count FROM ${TABLE}
      ORDER BY metric_version, month_start`,
  );
  return rows;
}

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fibreflow_user') THEN
      CREATE ROLE fibreflow_user NOLOGIN;
    END IF;
  END $$;`);
  await admin.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO fibreflow_user`);
  await db.query(PREREQUISITES);
  await db.query(INCIDENTS);
  await db.query(DRIVER_INPUT);
  await db.query(RETENTION);
  aggregates = await import('@/modules/fleet/incidents/analytics/aggregateRepository');
}, 120_000);

afterAll(async () => {
  const { pool: appPool } = await import('@/lib/db-pool');
  await appPool.end();
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

beforeEach(async () => {
  // Back to the pre-530 state, so every case observes what THIS migration does
  // rather than what a previous case left behind.
  await db.query(ROLLBACK);
  await db.query(`DELETE FROM fleet_operational_monthly_aggregates`);
  await db.query(`DELETE FROM fleet_operational_aggregation_runs`);
});

describe('the table exists only once its migration runs', () => {
  it('is absent beforehand, so the gate cannot silently predate it', async () => {
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`, [SCHEMA, TABLE],
    );
    expect(rows).toHaveLength(0);
  });

  it('is created by the forward migration and dropped by the rollback', async () => {
    await db.query(FORWARD);
    const created = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`, [SCHEMA, TABLE],
    );
    expect(created.rows).toHaveLength(1);
    await db.query(ROLLBACK);
    const dropped = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`, [SCHEMA, TABLE],
    );
    expect(dropped.rows).toHaveLength(0);
  });

  it('is repeatable in both directions', async () => {
    await db.query(FORWARD);
    await expect(db.query(FORWARD)).resolves.toBeTruthy();
    await db.query(ROLLBACK);
    await expect(db.query(ROLLBACK)).resolves.toBeTruthy();
  });
});

describe('constraints, each driven to rejection', () => {
  beforeEach(async () => { await db.query(FORWARD); });

  it('keys a month under exactly one version — a second row for the pair is refused', async () => {
    const run = await seedRun();
    await db.query(
      `INSERT INTO ${TABLE} (metric_version, month_start, aggregation_run_id, row_count)
       VALUES (1, '2026-01-01'::date, $1, 3)`, [run],
    );
    await expect(db.query(
      `INSERT INTO ${TABLE} (metric_version, month_start, aggregation_run_id, row_count)
       VALUES (1, '2026-01-01'::date, $1, 9)`, [run],
    )).rejects.toMatchObject({ code: '23505' });
  });

  it('keys on the PAIR — the same month under another version is a different row', async () => {
    const run = await seedRun();
    await db.query(
      `INSERT INTO ${TABLE} (metric_version, month_start, aggregation_run_id, row_count)
       VALUES (1, '2026-01-01'::date, $1, 3)`, [run],
    );
    await expect(db.query(
      `INSERT INTO ${TABLE} (metric_version, month_start, aggregation_run_id, row_count)
       VALUES (2, '2026-01-01'::date, $1, 3)`, [run],
    )).resolves.toBeTruthy();
  });

  /**
   * The PK columns and their ORDER, from the catalog. `replaceMonth`'s upsert
   * names `(metric_version, month_start)` as its conflict target and Postgres
   * matches that against a real constraint at parse time; a key of a different
   * shape makes every nightly write fail with 42P10.
   */
  it('is a two-column primary key on (metric_version, month_start)', async () => {
    const { rows } = await db.query<{ columns: string[] }>(
      `SELECT array_agg(a.attname::text ORDER BY k.ord) AS columns
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        WHERE n.nspname = $1 AND t.relname = $2 AND c.contype = 'p'`,
      [SCHEMA, TABLE],
    );
    expect(rows[0]?.columns).toEqual(['metric_version', 'month_start']);
  });

  it('refuses a month_start that is not the first of a month', async () => {
    const run = await seedRun();
    await expect(db.query(
      `INSERT INTO ${TABLE} (metric_version, month_start, aggregation_run_id, row_count)
       VALUES (1, '2026-01-15'::date, $1, 3)`, [run],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses a coverage row that names no real aggregation run', async () => {
    await expect(db.query(
      `INSERT INTO ${TABLE} (metric_version, month_start, aggregation_run_id, row_count)
       VALUES (1, '2026-01-01'::date, '99999999-9999-4999-8999-999999999999'::uuid, 3)`,
    )).rejects.toMatchObject({ code: '23503' });
  });

  it('refuses a negative row count, and accepts zero as the complete answer it is', async () => {
    const run = await seedRun();
    await expect(db.query(
      `INSERT INTO ${TABLE} (metric_version, month_start, aggregation_run_id, row_count)
       VALUES (1, '2026-02-01'::date, $1, -1)`, [run],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(db.query(
      `INSERT INTO ${TABLE} (metric_version, month_start, aggregation_run_id, row_count)
       VALUES (1, '2026-02-01'::date, $1, 0)`, [run],
    )).resolves.toBeTruthy();
  });
});

/**
 * Every privilege the writer and the gate actually need, exercised as the role
 * the application connects as. Without the migration's GRANT each of these is
 * 42501 — which is what a purge run would hit at 03:30, not a test.
 */
describe('what the application role may do with it', () => {
  beforeEach(async () => { await db.query(FORWARD); });

  it('may write, read, upsert and clear a coverage row', async () => {
    const run = await seedRun();
    await asAppRole(async (exec) => {
      await exec(
        `INSERT INTO ${TABLE} (metric_version, month_start, aggregation_run_id, row_count)
         VALUES (1, '2026-03-01'::date, $1, 2)`, [run],
      );
      await exec(
        `INSERT INTO ${TABLE} (metric_version, month_start, aggregation_run_id, row_count)
         VALUES (1, '2026-03-01'::date, $1, 7)
         ON CONFLICT (metric_version, month_start) DO UPDATE SET row_count = EXCLUDED.row_count`, [run],
      );
      await exec(`SELECT COUNT(*) FROM ${TABLE}`);
      // DELETE is not optional: `replaceMonth` clears a superseded version's
      // coverage in the same transaction that retires its rows.
      await exec(`DELETE FROM ${TABLE} WHERE metric_version <> 1`);
    });
  });

  it('is refused everything once the rollback removes the table', async () => {
    await db.query(ROLLBACK);
    await expect(asAppRole((exec) => exec(`SELECT COUNT(*) FROM ${TABLE}`)))
      .rejects.toMatchObject({ code: '42P01' });
  });
});

/**
 * The writer, executed. Everything below drives `replaceMonth` against real
 * Postgres rather than a client that records SQL text.
 */
describe('replaceMonth writes the coverage row', () => {
  beforeEach(async () => { await db.query(FORWARD); });

  it('records the month, the version, the run and the row count', async () => {
    const run = await seedRun();
    await aggregates.replaceMonth('2026-04-01', 1, [releasedRow('2026-04-01', 1)], run);

    const rows = await coverageRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ metric_version: 1, aggregation_run_id: run, row_count: 1 });
    expect(rows[0]!.month_start.getDate()).toBe(1);
  });

  it('records a month that published nothing — the whole defect, executed', async () => {
    const run = await seedRun();
    await aggregates.replaceMonth('2026-04-01', 1, [], run);

    const rows = await coverageRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ row_count: 0 });
  });

  /**
   * Night two. The nightly job re-aggregates its whole recalculation window, so
   * this key is rewritten every night — and the conflict target has to match a
   * real constraint or the very first write fails at parse time with 42P10.
   */
  it('upserts on the second night rather than colliding', async () => {
    const firstNight = await seedRun();
    await aggregates.replaceMonth('2026-04-01', 1, [releasedRow('2026-04-01', 1)], firstNight);

    const secondNight = await seedRun();
    await aggregates.replaceMonth(
      '2026-04-01', 1, [releasedRow('2026-04-01', 1), releasedRow('2026-04-01', 1, 'incident.wrong_site')], secondNight,
    );

    const rows = await coverageRows();
    // Still ONE row for the month, now naming the LATEST run to have covered it.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ aggregation_run_id: secondNight, row_count: 2 });
  });

  it('records an unchanged month again, naming the run that re-confirmed it', async () => {
    const firstNight = await seedRun();
    await aggregates.replaceMonth('2026-04-01', 1, [releasedRow('2026-04-01', 1)], firstNight);

    const secondNight = await seedRun();
    const result = await aggregates.replaceMonth('2026-04-01', 1, [releasedRow('2026-04-01', 1)], secondNight);

    expect(result).toEqual({ changed: false, rowsWritten: 0 });
    expect((await coverageRows())[0]).toMatchObject({ aggregation_run_id: secondNight });
  });

  it('keeps months apart — one row per month, each naming its own', async () => {
    const run = await seedRun();
    await aggregates.replaceMonth('2026-04-01', 1, [releasedRow('2026-04-01', 1)], run);
    await aggregates.replaceMonth('2026-05-01', 1, [releasedRow('2026-05-01', 1)], run);
    expect(await coverageRows()).toHaveLength(2);
  });

  /**
   * The blocker this migration's writer was corrected for: retiring a previous
   * version's ROWS must retire the coverage that speaks for them, or the gate
   * answers yes for a month the published view returns nothing for.
   */
  it('clears the superseded version coverage when a bump replaces it', async () => {
    await aggregates.replaceMonth('2026-06-01', 1, [releasedRow('2026-06-01', 1)], await seedRun(1));
    await aggregates.replaceMonth('2026-06-01', 2, [releasedRow('2026-06-01', 2)], await seedRun(2));

    const rows = await coverageRows();
    expect(rows.map((row) => row.metric_version)).toEqual([2]);
  });
});

/**
 * Scratch-schema fixture for the metric registry execution tests.
 *
 * The seeded migration container has none of the three metric source tables, and
 * that suite must never touch the shared dev+prod database (see the CI job
 * comment on "Migration tests — real Postgres"). So the tables are created here
 * with the LIVE column types — measured 2026-08-02 against
 * `information_schema.columns` — and seeded with rows chosen to exercise the
 * failure modes the metrics can hit silently.
 *
 * Lives in its own module so the test file stays inside the project's 300-line
 * limit and so a second test file can reuse the same fixture.
 *
 * The schema name is deliberately NOT `mig<N>_scratch`: those are keyed by
 * migration number, so two tests sharing a number would share a schema.
 */
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

export const SCHEMA = 'metric_registry_scratch';

const CANONICAL_FN = readFileSync(
  join(process.cwd(), 'scripts/migrations/sql/477_conformed_project_dimension.sql'),
  'utf8',
);

export function createPool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: false,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
}

/** Run inside the scratch schema so the metrics' unqualified table names resolve to it. */
export async function scoped<T = Record<string, unknown>>(
  pool: Pool,
  sql: string,
  params: unknown[] = [],
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

export async function setupFixture(pool: Pool): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  const run = (sql: string) => scoped(pool, sql);

  await run(
    `CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz DEFAULT NOW())`,
  );
  // canonical_project() is what the `project` dimension expression calls.
  await run(CANONICAL_FN);

  await run(`
    CREATE TABLE project_weekly_zone_pon_uptake (
      week_ending  date,
      project_name character varying(100),
      zone_no      integer,
      installed    integer
    )`);
  await run(`
    CREATE TABLE dr_photo_unified_reviews (
      drop_number      character varying(50),
      project          character varying(100),
      created_at       timestamptz,
      wa_received_at   timestamptz,
      installer_name   character varying(255),
      oes_activated_at timestamptz
    )`);
  await run(`
    CREATE TABLE metric_snapshots (
      id          bigserial PRIMARY KEY,
      source_key  text NOT NULL,
      as_of_date  date NOT NULL,
      entity_id   text NOT NULL,
      dims        jsonb NOT NULL,
      measures    jsonb NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT NOW()
    )`);
  // Mirrors production exactly, including WHERE the uniqueness lives: the primary
  // key is on `id`, and (source_key, as_of_date) is unique via a SEPARATE index.
  // pp_open_balance's LEFT JOIN depends on that index — without it two run rows
  // for one night fan the join out and double-count every entity — so the fixture
  // must reproduce the real guarantee rather than a composite primary key that
  // happens to imply it.
  await run(`
    CREATE TABLE snapshot_runs (
      id           bigserial PRIMARY KEY,
      source_key   text NOT NULL,
      as_of_date   date NOT NULL,
      row_count    integer NOT NULL,
      completed_at timestamptz NOT NULL DEFAULT NOW()
    )`);
  await run(
    `CREATE UNIQUE INDEX snapshot_runs_source_date_key ON snapshot_runs (source_key, as_of_date)`,
  );

  // ── zone_uptake ───────────────────────────────────────────────────────────
  // `installed` is CUMULATIVE. These four weekly figures are the REAL July 2026
  // totals measured on production: 21,666 -> 22,556 -> 23,342 -> 23,732. They sum
  // to 91,296, which is the wrong answer a naive sum produces.
  await run(`
    INSERT INTO project_weekly_zone_pon_uptake (week_ending, project_name, zone_no, installed)
    VALUES ('2026-07-03','Lawley',1,21666),
           ('2026-07-10','Lawley',1,22556),
           ('2026-07-17','Lawley',1,23342),
           ('2026-07-24','Lawley',1,23732)`);

  // ── install_activation_gap ────────────────────────────────────────────────
  // 'TEM' and 'Thembisa POP 1' BOTH canonicalise to 'Thembisa POP 1'. Not
  // hypothetical: production's dr_photo_unified_reviews holds exactly this pair,
  // and it is what makes the GROUP BY alias bug observable. Both fall in one month.
  await run(`
    INSERT INTO dr_photo_unified_reviews
      (drop_number, project, created_at, wa_received_at, installer_name, oes_activated_at)
    VALUES ('DR001','TEM',            '2026-07-05T09:00:00Z','2026-07-05T09:00:00Z', NULL,          NULL),
           ('DR002','Thembisa POP 1', '2026-07-06T09:00:00Z','2026-07-06T09:00:00Z', NULL,          NULL),
           ('DR003','Lawley',         '2026-07-07T09:00:00Z', NULL,                  'Installer A', NULL),
           -- Activated: excluded by the definition's own predicate.
           ('DR004','Lawley',         '2026-07-08T09:00:00Z','2026-07-08T09:00:00Z', NULL,          '2026-07-09T09:00:00Z'),
           -- Neither WA nor a 1Map installer: not an install, excluded.
           ('DR005','Lawley',         '2026-07-09T09:00:00Z', NULL,                  NULL,          NULL),
           -- Last instant of the final day: only a HALF-OPEN upper bound keeps it.
           ('DR006','Lawley',         '2026-07-31T23:59:00+02','2026-07-31T23:59:00+02', NULL,      NULL)`);

  // ── pp_open_balance ───────────────────────────────────────────────────────
  // A nightly STOCK driven from snapshot_runs. Four deliberately different days:
  //   07-27  run says 2 rows, only 1 present -> DAMAGED, must be absent
  //   07-28  no run at all                   -> must be ABSENT (never captured)
  //   07-29  run, zero entities              -> must report 0 (captured, empty)
  //   07-30  run, 1 entity
  //   07-31  run, 2 entities                 -> the latest night
  // PP-1 is open on 07-30 AND 07-31, so summing the days would count it twice.
  await run(`
    INSERT INTO snapshot_runs (source_key, as_of_date, row_count)
    VALUES ('pp_open','2026-07-27',2), ('pp_open','2026-07-29',0),
           ('pp_open','2026-07-30',1), ('pp_open','2026-07-31',2),
           -- Deliberately on 07-31, a date pp_open DID capture. Putting it on a
           -- date with no pp_open run would make the source-key regression test
           -- unfalsifiable: the metric WHERE clause alone would already exclude
           -- it, so dropping the join source_key predicate would not change the
           -- result and the test could never fail for that mutation.
           ('tickets_open','2026-07-31',1)`);
  await run(`
    INSERT INTO metric_snapshots (source_key, as_of_date, entity_id, dims, measures)
    VALUES ('pp_open','2026-07-30','PP-1','{"project":"TEM","olt_name":"tem.olt.01"}','{"age_days":10}'),
           ('pp_open','2026-07-31','PP-1','{"project":"TEM","olt_name":"tem.olt.01"}','{"age_days":11}'),
           ('pp_open','2026-07-31','PP-2','{"project":"Lawley","olt_name":"law.olt.01"}','{"age_days":3}'),
           -- 07-27's run claims 2 rows; only this one survives. Damaged.
           ('pp_open','2026-07-27','PP-9','{"project":"Lawley","olt_name":"law.olt.01"}','{"age_days":1}'),
           -- A different source, on a date pp_open also captured.
           ('tickets_open','2026-07-31','T-1','{"project":"Lawley"}','{"age_days":1}')`);
}

export async function teardownFixture(pool: Pool): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.end();
}

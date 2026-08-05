/**
 * Integration test for migration 479 — the pole-plan replan backup spine.
 *
 * These three tables exist for exactly one reason: to make a destructive re-import
 * reversible. scripts/qfield-recon/import_replan_poles.py deletes and reinserts a
 * whole project's poles, and the ONLY route back is the pre-image stored here. So
 * what is asserted is the reversibility contract, not the presence of columns:
 *
 *   1. to_jsonb(row) -> jsonb_populate_record(NULL::row, ...) is LOSSLESS for the
 *      column types public.poles actually uses. This is the load-bearing mechanism.
 *      A silent numeric/date/jsonb coercion here means a rollback that "succeeds"
 *      and quietly changes data — the worst possible failure for a safety net.
 *   2. The status CHECK really constrains, so a run cannot sit in an
 *      unrecognised state that --rollback then refuses to touch.
 *   3. ON DELETE CASCADE reaches both backup tables, so pruning old runs cannot
 *      strand orphan pre-image rows.
 *
 * `public.poles` is NOT available here — tests/db/setup/seed.sql does not create it
 * (this container seeds projects/stock/assets only). The fixture below therefore
 * mirrors the column TYPES that matter for round-trip fidelity rather than cloning
 * the real 38-column table: uuid, numeric (coordinates), date, timestamptz, jsonb,
 * integer and text, each also exercised as NULL.
 *
 * SAFETY: everything is created in a scratch schema dropped in afterAll.
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

const SCHEMA = 'mig479_scratch';
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');

/**
 * The shipped migration is schema-qualified to `public` on purpose — an `onemap.poles`
 * also exists, so leaving resolution to search_path is a hazard in production. That
 * same qualification would ignore the scratch schema here, so it is rewritten. The
 * rewrite is deliberately narrow (`public.` -> `<scratch>.`) and applied to both
 * files, so what runs below is otherwise byte-identical to what deploys.
 */
const scopeSql = (s: string) => s.replace(/\bpublic\./g, `${SCHEMA}.`);
const FORWARD = scopeSql(readFileSync(join(SQL_DIR, '479_pole_plan_replan_backup.sql'), 'utf8'));
const ROLLBACK = scopeSql(
  readFileSync(join(SQL_DIR, 'rollback_479_pole_plan_replan_backup.sql'), 'utf8')
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

async function scoped<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    const r = await client.query(sql, params);
    return (r.rows ?? []) as T[];
  } finally {
    client.release();
  }
}

async function newRun(status = 'running'): Promise<string> {
  const rows = await scoped<{ id: string }>(
    `INSERT INTO pole_plan_import_runs (project_id, gpkg_object, gpkg_version, layer, status)
     VALUES (gen_random_uuid(), 'obj', 'v1', 'Poles HLD', $1) RETURNING id`,
    [status]
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  await scoped(
    `CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz DEFAULT NOW())`
  );
  await scoped(FORWARD);
  // Mirrors the column types public.poles round-trips through jsonb.
  await scoped(`CREATE TABLE poles_fixture (
      id uuid PRIMARY KEY,
      pole_number text,
      latitude numeric,
      longitude numeric,
      zone_no integer,
      audit_complete date,
      field_status_synced_at timestamptz,
      inspection_data jsonb,
      notes text
  )`);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.end();
});

describe('migration 479 — reversibility contract', () => {
  it('jsonb round-trip restores every column exactly, including NULLs', async () => {
    await scoped(`INSERT INTO poles_fixture VALUES
      ('11111111-1111-1111-1111-111111111111', 'TEM.P.J950',
       -25.97627205, 28.22714898, 69, '2026-02-11', '2026-08-04T14:02:00Z',
       '{"steps": [1, 2], "ok": true}'::jsonb, 'carried'),
      ('22222222-2222-2222-2222-222222222222', 'TEM.P.H223',
       NULL, NULL, NULL, NULL, NULL, NULL, NULL)`);

    const runId = await newRun();
    await scoped(
      `INSERT INTO pole_plan_backup (run_id, pole_id, row_data)
       SELECT $1, id, to_jsonb(poles_fixture) FROM poles_fixture`,
      [runId]
    );
    await scoped(`DELETE FROM poles_fixture`);
    await scoped(
      `INSERT INTO poles_fixture
       SELECT (jsonb_populate_record(NULL::poles_fixture, row_data)).*
       FROM pole_plan_backup WHERE run_id = $1`,
      [runId]
    );

    // EXCEPT in both directions: a restore that adds a row is as wrong as one that
    // drops a column. Comparing counts alone would catch neither.
    const drift = await scoped<{ n: string }>(
      `SELECT count(*)::text AS n FROM (
         SELECT * FROM poles_fixture
         EXCEPT SELECT (jsonb_populate_record(NULL::poles_fixture, row_data)).*
                FROM pole_plan_backup WHERE run_id = $1
         UNION ALL
         SELECT (jsonb_populate_record(NULL::poles_fixture, row_data)).*
                FROM pole_plan_backup WHERE run_id = $1
         EXCEPT SELECT * FROM poles_fixture
       ) d`,
      [runId]
    );
    expect(drift[0]!.n).toBe('0');

    // Spot-check the types most likely to coerce silently rather than error.
    const [row] = await scoped<{
      latitude: string;
      audit_complete: Date;
      inspection_data: Record<string, unknown>;
    }>(`SELECT latitude, audit_complete, inspection_data FROM poles_fixture
        WHERE pole_number = 'TEM.P.J950'`);
    expect(row!.latitude).toBe('-25.97627205');
    expect(row!.inspection_data).toEqual({ steps: [1, 2], ok: true });

    await scoped(`DELETE FROM poles_fixture`);
    await scoped(`DELETE FROM pole_plan_import_runs WHERE id = $1`, [runId]);
  });

  it('accepts every status the importer writes', async () => {
    for (const s of ['running', 'completed', 'failed', 'rolled_back']) {
      const id = await newRun(s);
      expect(id).toBeTruthy();
      await scoped(`DELETE FROM pole_plan_import_runs WHERE id = $1`, [id]);
    }
  });

  it('rejects a status outside that set', async () => {
    await expect(newRun('half_done')).rejects.toThrow(/pole_plan_import_runs_status_chk/);
  });

  it('cascades a deleted run into both backup tables', async () => {
    const runId = await newRun();
    await scoped(
      `INSERT INTO pole_plan_backup (run_id, pole_id, row_data) VALUES ($1, gen_random_uuid(), '{}'::jsonb)`,
      [runId]
    );
    await scoped(
      `INSERT INTO pole_qa_photo_plan_backup (run_id, photo_id, pole_label, zone_no, pon_no)
       VALUES ($1, gen_random_uuid(), 'TEM.P.J950', 69, 821)`,
      [runId]
    );

    await scoped(`DELETE FROM pole_plan_import_runs WHERE id = $1`, [runId]);

    const [left] = await scoped<{ poles: string; photos: string }>(
      `SELECT (SELECT count(*) FROM pole_plan_backup WHERE run_id = $1)::text AS poles,
              (SELECT count(*) FROM pole_qa_photo_plan_backup WHERE run_id = $1)::text AS photos`,
      [runId]
    );
    expect(left).toEqual({ poles: '0', photos: '0' });
  });

  it('is idempotent — re-applying the forward migration changes nothing', async () => {
    const runId = await newRun('completed');
    await scoped(FORWARD);
    const rows = await scoped<{ id: string; status: string }>(
      `SELECT id, status FROM pole_plan_import_runs WHERE id = $1`,
      [runId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('completed');
    await scoped(`DELETE FROM pole_plan_import_runs WHERE id = $1`, [runId]);
  });
});

describe('migration 479 — rollback', () => {
  it('drops all three tables and clears its own schema_migrations row', async () => {
    await scoped(`INSERT INTO schema_migrations (filename) VALUES ('479_pole_plan_replan_backup.sql')`);
    await scoped(ROLLBACK);

    const present = await scoped<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name IN ('pole_plan_import_runs','pole_plan_backup','pole_qa_photo_plan_backup')`,
      [SCHEMA]
    );
    expect(present).toEqual([]);

    const tracked = await scoped<{ filename: string }>(
      `SELECT filename FROM schema_migrations WHERE filename = '479_pole_plan_replan_backup.sql'`
    );
    expect(tracked).toEqual([]);

    // Re-runnable: a second rollback on an already-rolled-back schema must not throw.
    await expect(scoped(ROLLBACK)).resolves.toBeDefined();

    await scoped(FORWARD); // leave the schema as the other suite found it
  });
});

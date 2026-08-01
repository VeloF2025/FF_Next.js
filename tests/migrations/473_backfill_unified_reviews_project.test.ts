/**
 * Integration test for migration 473 — backfill dr_photo_unified_reviews.project.
 *
 * A stub-client test cannot check what actually matters about this migration.
 * The properties that make it safe to run against a database shared by dev AND
 * production are all properties of RUNNING the SQL:
 *
 *   - it only ever fills NULLs, never overwrites an existing project
 *   - it leaves rows with no matching `drops` row alone (still NULL)
 *   - it is idempotent — a second run updates nothing
 *   - the correlated subquery stays single-valued even when a drop_number
 *     spans two project_ids (schema permits it: `drops` is UNIQUE on
 *     (project_id, drop_number), NOT on drop_number alone)
 *   - the SQL parses at all — a stub client asserting on query strings would
 *     happily "pass" against SQL Postgres rejects
 *
 * So this runs the real file, byte-identical, with no rewriting. 473 references
 * its tables unqualified, so pointing `search_path` at a scratch schema is
 * enough to sandbox it — unlike 472, which hard-qualifies `public.` and needs a
 * string substitution.
 *
 * Sibling of 358_snag_reports_scope / 378_rbac_field_stock_force_correct /
 * 471_hs_training_certificate_upload / 472_works_qa_pole_planning_view:
 * requires TEST_DATABASE_URL, and is excluded from the unit vitest config
 * (vitest.config.ts) because it throws at module load without one.
 *
 * Being in that exclude list also means `npx vitest run <this file>` reports
 * "No test files found" — the exclusion wins over an explicit path argument,
 * and vitest 0.34 has no `--exclude` CLI override. To run it, point vitest at a
 * throwaway config (kept OUT of the repo) that reuses this project's aliases:
 *
 *   cat > vitest.tmp.config.ts <<'EOF'
 *   import base from './vitest.config';
 *   import { defineConfig } from 'vitest/config';
 *   export default defineConfig({ ...base, test: { ...(base as any).test,
 *     include: ['tests/migrations/473_backfill_unified_reviews_project.test.ts'],
 *     exclude: ['node_modules', '.next', 'dist'] } });
 *   EOF
 *   TEST_DATABASE_URL=postgres://... npx vitest run --config vitest.tmp.config.ts
 *   rm vitest.tmp.config.ts
 *
 * The config must sit inside the repo — from /tmp, Node cannot resolve
 * 'vitest/config'.
 *
 * SAFETY: everything happens in a scratch schema dropped unconditionally in
 * afterAll, and the migration is executed on a client whose search_path points
 * only at that schema — it cannot see, let alone write, the real tables. The
 * rollback file is never run here: it carries an unconditional DELETE against
 * schema_migrations.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
      'See .env.local.example.'
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const SCHEMA = 'mig473_scratch';
const FORWARD = readFileSync(
  join(process.cwd(), 'scripts/migrations/sql/473_backfill_unified_reviews_project.sql'),
  'utf8'
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

const P_ALPHA = '11111111-1111-1111-1111-111111111111';
const P_BETA = '22222222-2222-2222-2222-222222222222';

/** Client pinned to the scratch schema — the migration runs sandboxed on this. */
let client: PoolClient;

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await client.query(sql, params);
  return r.rows as T[];
}

/** Runs the real migration file and returns how many rows it changed. */
async function runForward(): Promise<number> {
  const r = await client.query(FORWARD);
  return r.rowCount ?? 0;
}

beforeAll(async () => {
  client = await pool.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  // Sandbox: the unqualified names in 473 resolve here and nowhere else.
  await client.query(`SET search_path TO ${SCHEMA}`);

  // Minimal stand-ins carrying only the columns the migration touches.
  await q(`CREATE TABLE projects (id uuid PRIMARY KEY, project_name varchar(255) NOT NULL)`);
  // Mirrors the real key: UNIQUE on (project_id, drop_number), NOT drop_number.
  await q(`
    CREATE TABLE drops (
      project_id uuid NOT NULL,
      drop_number varchar(100) NOT NULL,
      UNIQUE (project_id, drop_number)
    )`);
  await q(`
    CREATE TABLE dr_photo_unified_reviews (
      drop_number varchar(100) PRIMARY KEY,
      project varchar(255),
      updated_at timestamptz
    )`);

  await q(`INSERT INTO projects (id, project_name) VALUES ($1,'Alpha'), ($2,'Beta')`, [
    P_ALPHA,
    P_BETA,
  ]);
  await q(
    `INSERT INTO drops (project_id, drop_number) VALUES
       ($1,'DR.RESOLVABLE'),
       ($1,'DR.ALREADY.SET'),
       ($2,'DR.SPANS.TWO'),
       ($1,'DR.SPANS.TWO')`,
    [P_ALPHA, P_BETA]
  );
  await q(`
    INSERT INTO dr_photo_unified_reviews (drop_number, project, updated_at) VALUES
      ('DR.RESOLVABLE',  NULL,           NULL),
      ('DR.ALREADY.SET', 'Handset',      NULL),
      ('DR.SPANS.TWO',   NULL,           NULL),
      ('DR.ORPHAN',      NULL,           NULL)`);
});

afterAll(async () => {
  await client?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => undefined);
  client?.release();
  await pool.end();
});

async function projectOf(dropNumber: string): Promise<string | null> {
  const rows = await q<{ project: string | null }>(
    `SELECT project FROM dr_photo_unified_reviews WHERE drop_number = $1`,
    [dropNumber]
  );
  return rows[0]?.project ?? null;
}

describe('migration 473 — backfill unified reviews project', () => {
  it('fills a NULL project from drops, and is scoped to exactly the resolvable NULLs', async () => {
    const changed = await runForward();

    // DR.RESOLVABLE and DR.SPANS.TWO qualify. DR.ALREADY.SET is not NULL;
    // DR.ORPHAN has no drops row.
    expect(changed).toBe(2);
    expect(await projectOf('DR.RESOLVABLE')).toBe('Alpha');
  });

  it('never overwrites a project that was already set', async () => {
    expect(await projectOf('DR.ALREADY.SET')).toBe('Handset');
  });

  it('leaves a row with no matching drops row as NULL', async () => {
    expect(await projectOf('DR.ORPHAN')).toBeNull();
  });

  it('stays single-valued and deterministic when a drop spans two projects', async () => {
    // Both Alpha and Beta claim DR.SPANS.TWO. Without ORDER BY the pick would
    // be plan-dependent; with it, the lowest project_name wins, matching what
    // the ensure-data.ts insert resolves for the same drop.
    expect(await projectOf('DR.SPANS.TWO')).toBe('Alpha');
  });

  it('is idempotent — a second run changes nothing', async () => {
    const changedAgain = await runForward();
    expect(changedAgain).toBe(0);
  });
});

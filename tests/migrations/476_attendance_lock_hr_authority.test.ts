/**
 * Execution test for migration 476 — payroll-week lock authority.
 *
 * 476 shipped with no test at all. That is not a neutral omission here: the migration CI
 * gate exits 0 when no test file exists, so "absent" reads as "green" and the SQL is never
 * executed by CI in any form. A stub-client test cannot close that hole either — it is
 * blind to parse-time errors, which is how a 42P08 previously reached production behind a
 * green build. Only really running the statements catches that class.
 *
 * What is asserted, beyond "it parses":
 *   - the grant matrix the migration exists to establish (manager demoted to read-only,
 *     admin/super_admin become the lock authority);
 *   - idempotency, since the deploy runner may re-apply and the single shared dev/prod
 *     database gives a second application real consequences;
 *   - that the ON CONFLICT arbiter is actually backed by a unique constraint — without
 *     `UNIQUE (role, permission_key)` the statement raises 42P10 at runtime, and nothing
 *     in the migration itself creates that constraint (it predates this file);
 *   - that the rollback restores the previous grant AND clears its own schema_migrations
 *     row, so a rolled-back migration does not leave the tracker claiming it is applied.
 *
 * SAFETY: everything happens in a scratch schema dropped in afterAll. Nothing touches the
 * real role_permissions table — dev and production share one database.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
      'See .env.local.example.'
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const SCHEMA = 'mig476_scratch';
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD_FILE = '476_attendance_lock_hr_authority.sql';
const FORWARD = readFileSync(join(SQL_DIR, FORWARD_FILE), 'utf8');
const ROLLBACK = readFileSync(
  join(SQL_DIR, 'rollback_476_attendance_lock_hr_authority.sql'),
  'utf8'
);

const LOCKS_KEY = 'people.staff.attendance.locks';
const BULK_KEY = 'people.staff.attendance.bulk_lock';

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

interface ActionsRow {
  actions: { view: boolean; create: boolean; edit: boolean; delete: boolean };
}

async function actionsFor(role: string, key: string): Promise<ActionsRow['actions'] | null> {
  const rows = await scoped<ActionsRow>(
    `SELECT actions FROM role_permissions WHERE role = $1 AND permission_key = $2`,
    [role, key]
  );
  return rows[0]?.actions ?? null;
}

beforeAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
});

beforeEach(async () => {
  // Rebuild from scratch each time so idempotency and rollback are tested against a known
  // starting point rather than whatever the previous case left behind.
  await scoped(`DROP TABLE IF EXISTS role_permissions`);
  await scoped(`DROP TABLE IF EXISTS schema_migrations`);
  await scoped(`
    CREATE TABLE role_permissions (
      role text NOT NULL,
      permission_key text NOT NULL,
      actions jsonb NOT NULL,
      -- The arbiter 476's ON CONFLICT names. Migration 378 already relies on it in
      -- production; reproducing it here is what makes this test meaningful rather than
      -- accidentally passing against a shape the real database does not have.
      CONSTRAINT role_permissions_role_key_unique UNIQUE (role, permission_key)
    )`);
  await scoped(
    `CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz DEFAULT NOW())`
  );
  // The pre-476 world: migration 320 gave manager full lock control.
  await scoped(
    `INSERT INTO role_permissions (role, permission_key, actions) VALUES
       ('manager', $1, '{"view":true,"create":true,"edit":true,"delete":false}')`,
    [LOCKS_KEY]
  );
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.end();
});

describe('migration 476 — attendance lock HR authority', () => {
  it('executes and demotes manager to read-only while admins gain lock authority', async () => {
    await scoped(FORWARD);

    expect(await actionsFor('manager', LOCKS_KEY)).toMatchObject({
      view: true,
      create: false,
      edit: false,
    });
    expect(await actionsFor('admin', LOCKS_KEY)).toMatchObject({
      view: true,
      create: true,
      edit: true,
      delete: false,
    });
    expect(await actionsFor('super_admin', LOCKS_KEY)).toMatchObject({
      view: true,
      create: true,
      edit: true,
      delete: true,
    });

    // Bulk lock stays away from manager entirely.
    expect(await actionsFor('manager', BULK_KEY)).toMatchObject({ view: false, create: false });
    expect(await actionsFor('admin', BULK_KEY)).toMatchObject({ view: true, create: true });
  });

  it('is idempotent — a second application changes nothing', async () => {
    await scoped(FORWARD);
    const first = await scoped(
      `SELECT role, permission_key, actions FROM role_permissions ORDER BY permission_key, role`
    );

    await scoped(FORWARD);
    const second = await scoped(
      `SELECT role, permission_key, actions FROM role_permissions ORDER BY permission_key, role`
    );

    expect(second).toEqual(first);
  });

  it('rollback restores the manager grant and clears its own tracker row', async () => {
    await scoped(FORWARD);
    // Stand in for the migration runner, which is what records the row in production.
    await scoped(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [FORWARD_FILE]);

    await scoped(ROLLBACK);

    expect(await actionsFor('manager', LOCKS_KEY)).toMatchObject({
      view: true,
      create: true,
      edit: true,
    });
    // Without this DELETE the schema is rolled back while the tracker still reports the
    // migration as applied, so the forward runner skips it and never repairs the state.
    const remaining = await scoped(`SELECT filename FROM schema_migrations WHERE filename = $1`, [
      FORWARD_FILE,
    ]);
    expect(remaining).toHaveLength(0);
  });

  it('rollback is re-runnable', async () => {
    await scoped(FORWARD);
    await scoped(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [FORWARD_FILE]);

    await scoped(ROLLBACK);
    await expect(scoped(ROLLBACK)).resolves.toBeDefined();

    expect(await actionsFor('manager', LOCKS_KEY)).toMatchObject({ create: true, edit: true });
  });
});

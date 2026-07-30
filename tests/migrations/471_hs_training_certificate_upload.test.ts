/**
 * Integration test for migration 471 — classified training certificates.
 *
 * The point of this file is the one thing a static text-pin cannot check:
 * migration 471 contains a ONE-TIME backfill that stamps every existing
 * hs_worker_training row 'verified'. Unguarded, a second application would
 * silently approve every genuinely-pending submission in the table. The guard
 * is a constraint-existence check, and whether it actually holds is a property
 * of running the SQL, not of its shape — so this runs it, twice, and asserts a
 * pending row is still pending afterwards.
 *
 * Sibling of 358_snag_reports_scope / 378_rbac_field_stock_force_correct:
 * requires TEST_DATABASE_URL, and is excluded from the unit vitest config
 * (vitest.config.ts) because it throws at module load without one. Run with:
 *
 *   TEST_DATABASE_URL=postgres://... npx vitest run tests/migrations/471_*.test.ts
 *
 * SAFETY — read this before pointing it anywhere:
 * Everything happens inside a scratch schema that is dropped unconditionally in
 * afterAll, including a stand-in schema_migrations so the migration's own
 * tracker INSERT cannot touch a real 270-row tracker. It never runs the
 * rollback file, because that file carries its own COMMIT, which would end the
 * wrapping transaction and commit the scratch schema (this is how a stray
 * mig469_scratch schema was once left in the shared database). Point it at a
 * throwaway database anyway — a scratch schema is a seatbelt, not permission.
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

const SCHEMA = 'mig471_scratch';
const FORWARD = readFileSync(
  join(process.cwd(), 'scripts/migrations/sql/471_hs_training_certificate_upload.sql'),
  'utf8'
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

const LEGACY_ROW = '22222222-2222-2222-2222-222222222222';
const PENDING_ROW = '44444444-4444-4444-4444-444444444444';
const STAFF = '11111111-1111-1111-1111-111111111111';
const DOCUMENT = '33333333-3333-3333-3333-333333333333';

/** Run inside the scratch schema, never public. */
async function scoped(sql: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path = ${SCHEMA}, public`);
    await client.query(sql);
  } finally {
    client.release();
  }
}

async function scalar<T>(sql: string): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path = ${SCHEMA}, public`);
    const res = await client.query(sql);
    return Object.values(res.rows[0])[0] as T;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);

  // Minimal prerequisites, shaped like the live tables. staff_documents
  // deliberately carries NO check constraints, matching the live database —
  // that is what makes 471's constraint an ADD rather than a widen.
  await scoped(`
    CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE staff (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(255));
    CREATE TABLE team_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE contractors (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE staff_documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      document_type varchar(50) NOT NULL,
      document_name varchar(255) NOT NULL,
      file_url text NOT NULL,
      expiry_date date,
      issued_date date,
      issuing_authority varchar(255),
      document_number varchar(100),
      verification_status varchar(20) DEFAULT 'pending',
      verified_by uuid REFERENCES staff(id),
      verified_at timestamptz,
      verification_notes text,
      created_at timestamptz DEFAULT NOW(),
      updated_at timestamptz DEFAULT NOW(),
      status varchar(50)
    );
    CREATE TABLE hs_training_types (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code varchar(64) NOT NULL,
      name varchar(160) NOT NULL,
      description text,
      validity_months integer,
      is_statutory boolean NOT NULL DEFAULT false,
      requires_certificate boolean NOT NULL DEFAULT true,
      is_active boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX hs_training_types_code_key ON hs_training_types (code);
    CREATE TABLE hs_worker_training (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      training_type_id uuid NOT NULL REFERENCES hs_training_types(id) ON DELETE RESTRICT,
      staff_id uuid REFERENCES staff(id) ON DELETE CASCADE,
      team_member_id uuid REFERENCES team_members(id) ON DELETE CASCADE,
      contractor_id uuid REFERENCES contractors(id) ON DELETE CASCADE,
      worker_name text NOT NULL,
      project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
      completed_date date NOT NULL,
      expiry_date date,
      certificate_url text,
      certificate_number varchar(120),
      issued_by varchar(160),
      notes text,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT hs_worker_training_one_worker
        CHECK ((staff_id IS NOT NULL)::int + (team_member_id IS NOT NULL)::int = 1)
    );
    CREATE TABLE access_permissions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      type varchar(20) NOT NULL,
      key varchar(100) UNIQUE NOT NULL,
      parent_key varchar(100),
      label varchar(100) NOT NULL,
      description text,
      route varchar(200),
      sort_order int DEFAULT 0,
      is_active boolean DEFAULT true,
      created_at timestamptz DEFAULT NOW(),
      updated_at timestamptz DEFAULT NOW()
    );
    CREATE TABLE role_permissions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      role varchar(50) NOT NULL,
      permission_key varchar(100) NOT NULL REFERENCES access_permissions(key) ON DELETE CASCADE,
      actions jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT NOW(),
      updated_at timestamptz DEFAULT NOW(),
      UNIQUE(role, permission_key)
    );
    -- Stand-in: the migration's tracker INSERT resolves here, not to the real one.
    CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT NOW());

    INSERT INTO access_permissions (type, key, label) VALUES ('module', 'people.staff', 'Staff');
    INSERT INTO hs_training_types (code, name, validity_months, is_statutory)
      VALUES ('working_at_heights', 'Working at Heights', 24, true);
    INSERT INTO staff (id, name) VALUES ('${STAFF}', 'Legacy Worker');
    INSERT INTO hs_worker_training (id, training_type_id, staff_id, worker_name, completed_date)
      SELECT '${LEGACY_ROW}', t.id, '${STAFF}', 'Legacy Worker', DATE '2025-01-15'
      FROM hs_training_types t WHERE t.code = 'working_at_heights';
  `);
}, 60_000);

afterAll(async () => {
  // Unconditional — a scratch schema left behind in a shared database is the
  // exact failure this file is written to avoid.
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  const leaked = await pool.query(
    `SELECT COUNT(*)::int AS n FROM pg_namespace WHERE nspname LIKE 'mig471%'`
  );
  expect(leaked.rows[0].n).toBe(0);
  await pool.end();
}, 60_000);

describe('migration 471 applied to a scratch schema', () => {
  it('backfills pre-existing rows to verified on the first apply', async () => {
    await scoped(FORWARD);
    const status = await scalar<string>(
      `SELECT verification_status FROM hs_worker_training WHERE id = '${LEGACY_ROW}'`
    );
    expect(status).toBe('verified');
  }, 60_000);

  it('is idempotent, and its guard does not approve a pending submission on re-apply', async () => {
    // A real submission arrives between the two applications.
    await scoped(`
      INSERT INTO staff_documents (id, staff_id, document_type, document_name, file_url,
                                   verification_status, document_number, issuing_authority)
      VALUES ('${DOCUMENT}', '${STAFF}', 'certification', 'cert.pdf', 'x',
              'pending', 'CERT-001', 'Acme');
      INSERT INTO hs_worker_training (id, training_type_id, staff_id, worker_name,
                                      completed_date, staff_document_id, verification_status)
      SELECT '${PENDING_ROW}', t.id, '${STAFF}', 'Legacy Worker', DATE '2026-01-01',
             '${DOCUMENT}', 'pending'
      FROM hs_training_types t WHERE t.code = 'working_at_heights';
    `);

    await scoped(FORWARD);

    // THE ASSERTION THIS FILE EXISTS FOR. An unguarded backfill returns
    // 'verified' here, silently approving evidence nobody checked.
    const status = await scalar<string>(
      `SELECT verification_status FROM hs_worker_training WHERE id = '${PENDING_ROW}'`
    );
    expect(status).toBe('pending');
  }, 60_000);

  it('gives the lifecycle constraint teeth', async () => {
    await expect(
      scoped(`UPDATE hs_worker_training SET verification_status = 'bogus' WHERE id = '${PENDING_ROW}'`)
    ).rejects.toThrow(/hs_worker_training_verification_status_chk/);
  }, 60_000);

  it('links a document to a given competency at most once', async () => {
    await expect(
      scoped(`
        INSERT INTO hs_worker_training (training_type_id, staff_id, worker_name,
                                        completed_date, staff_document_id)
        SELECT t.id, '${STAFF}', 'Legacy Worker', DATE '2026-01-01', '${DOCUMENT}'
        FROM hs_training_types t WHERE t.code = 'working_at_heights';
      `)
    ).rejects.toThrow(/ux_hs_worker_training_document_type/);
  }, 60_000);

  it('rejects a duplicate live certificate number, ignoring case and padding', async () => {
    await expect(
      scoped(`
        INSERT INTO staff_documents (staff_id, document_type, document_name, file_url,
                                     verification_status, document_number, issuing_authority)
        VALUES ('${STAFF}', 'certification', 'c2.pdf', 'x', 'verified', '  cert-001 ', 'ACME');
      `)
    ).rejects.toThrow(/ux_staff_documents_certification_number/);
  }, 60_000);

  it('lets a corrected certificate reuse the number once the first is rejected', async () => {
    await scoped(`
      UPDATE staff_documents SET verification_status = 'rejected' WHERE id = '${DOCUMENT}';
      INSERT INTO staff_documents (staff_id, document_type, document_name, file_url,
                                   verification_status, document_number, issuing_authority)
      VALUES ('${STAFF}', 'certification', 'c3.pdf', 'x', 'pending', 'CERT-001', 'Acme');
    `);
    const live = await scalar<number>(
      `SELECT COUNT(*)::int FROM staff_documents
        WHERE document_number = 'CERT-001' AND verification_status = 'pending'`
    );
    expect(live).toBe(1);
  }, 60_000);

  it('grants the new permission to super_admin and nobody else', async () => {
    const roles = await scalar<string>(
      `SELECT COALESCE(string_agg(role, ','), '') FROM role_permissions
        WHERE permission_key = 'people.staff.training-certificates'`
    );
    expect(roles).toBe('super_admin');
  }, 60_000);
});

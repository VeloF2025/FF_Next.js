/**
 * Contract for migration 521 (DELETE grants for the Fleet retention purge).
 *
 * A grant migration is exactly the kind that looks too small to test and is
 * not: it is the difference between the purge working and 42501 in
 * production, its scope is a security boundary, and a superuser-only test
 * proves nothing about either.
 *
 * So this file asserts three things:
 *
 *   1. The seven programme tables gain DELETE for fibreflow_user — checked
 *      through information_schema, not by trusting the file's text.
 *   2. Nothing ELSE does. The source/master-data tables retention must never
 *      reach are asserted to have no DELETE, so widening this migration later
 *      breaks this test rather than passing quietly.
 *   3. The rollback returns all seven to append-only.
 *
 * It also probes who may APPLY it: these tables are owned by `postgres` in
 * production, GRANT requires ownership, and a runner that is not the owner
 * fails loudly. That is reproduced here rather than reasoned about.
 */
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const SCHEMA = 'mig521_retention_grants_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const INCIDENTS = readFileSync(join(SQL_DIR, '510_fleet_operational_incidents.sql'), 'utf8');
const DRIVER_INPUT = readFileSync(join(SQL_DIR, '511_fleet_incident_driver_input.sql'), 'utf8');
const RETENTION = readFileSync(join(SQL_DIR, '518_fleet_operational_analytics_retention.sql'), 'utf8');
const FORWARD = readFileSync(join(SQL_DIR, '521_fleet_retention_delete_grants.sql'), 'utf8');
const ROLLBACK = readFileSync(join(SQL_DIR, 'rollback_521_fleet_retention_delete_grants.sql'), 'utf8');

/** Exactly the tables the purge deletes from. */
const GRANTED_TABLES = [
  'fleet_operational_incidents',
  'fleet_operational_incident_observations',
  'fleet_operational_incident_actions',
  'fleet_operational_incident_evidence',
  'fleet_incident_driver_input_requests',
  'fleet_incident_driver_submissions',
  'fleet_incident_attendance_correction_links',
];

/**
 * Tables retention must NEVER be able to delete from. Source and master data
 * (Attendance, staff, projects, vehicles), plus the PR8 audit and hold-history
 * records that outlive the data they describe.
 */
const FORBIDDEN_DELETE_TABLES = [
  'attendance_adjustments',
  'staff',
  'projects',
  'fleet_vehicles',
  'fleet_project_operational_sites',
  'fleet_incident_retention_holds',
  'fleet_incident_retention_hold_actions',
  'fleet_operational_retention_runs',
  'fleet_operational_retention_items',
  'fleet_operational_analytics_settings',
  'fleet_operational_incident_rules',
  'fleet_operational_monitor_runs',
  'fleet_operational_oversight_members',
];

const PREREQUISITES = `
  -- Column names and types mirror production (verified against
  -- information_schema); a fixture may be a subset, never a re-typing.
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
  INSERT INTO access_permissions (type, key, label) VALUES ('module', 'fleet', 'Fleet');
`;

/** A stand-in for `migration_admin`: not a superuser, not the owner, no membership of the owner. */
const NON_OWNER_ROLE = 'mig521_non_owner_probe';

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 1 });
const nonOwner = new Pool({
  connectionString: `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA} -c role=${NON_OWNER_ROLE}`)}`,
  ssl: false, max: 1,
});

async function deleteGrantees(table: string): Promise<string[]> {
  const { rows } = await db.query<{ grantee: string }>(
    `SELECT grantee FROM information_schema.role_table_grants
      WHERE table_schema = $1 AND table_name = $2 AND privilege_type = 'DELETE'`,
    [SCHEMA, table],
  );
  return rows.map((row) => row.grantee);
}

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  for (const role of ['fibreflow_user', NON_OWNER_ROLE]) {
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
        CREATE ROLE ${role} NOLOGIN;
      END IF;
    END $$;`);
    await admin.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO ${role}`);
  }
  await db.query(PREREQUISITES);
  await db.query(INCIDENTS);
  await db.query(DRIVER_INPUT);
  await db.query(RETENTION);
}, 120_000);

afterAll(async () => {
  await nonOwner.end();
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

beforeEach(async () => {
  // Back to the pre-521 state before each case, so "granted" is always a
  // result of this migration rather than of a previous test.
  await db.query(ROLLBACK);
});

describe('forward migration', () => {
  it('leaves the programme tables append-only until it runs', async () => {
    for (const table of GRANTED_TABLES) {
      expect(await deleteGrantees(table), table).not.toContain('fibreflow_user');
    }
  });

  it('grants DELETE on exactly the seven tables the purge deletes from', async () => {
    await db.query(FORWARD);
    for (const table of GRANTED_TABLES) {
      expect(await deleteGrantees(table), table).toContain('fibreflow_user');
    }
  });

  // The scope IS the security boundary. If someone later adds a table to the
  // GRANT list, this fails — which is the point.
  it('grants DELETE on nothing else, source and master data least of all', async () => {
    await db.query(FORWARD);
    for (const table of FORBIDDEN_DELETE_TABLES) {
      expect(await deleteGrantees(table), table).not.toContain('fibreflow_user');
    }
  });

  it('is repeatable — GRANT is a no-op when the privilege is already held', async () => {
    await db.query(FORWARD);
    await expect(db.query(FORWARD)).resolves.toBeTruthy();
    expect(await deleteGrantees('fleet_operational_incidents')).toContain('fibreflow_user');
  });

  it('grants DELETE only — it does not widen any other privilege', async () => {
    const before = await db.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = $1 AND table_name = 'fleet_operational_incident_actions' AND grantee = 'fibreflow_user'
        ORDER BY privilege_type`, [SCHEMA],
    );
    await db.query(FORWARD);
    const after = await db.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = $1 AND table_name = 'fleet_operational_incident_actions' AND grantee = 'fibreflow_user'
        ORDER BY privilege_type`, [SCHEMA],
    );
    const added = after.rows.map((row) => row.privilege_type)
      .filter((privilege) => !before.rows.some((row) => row.privilege_type === privilege));
    expect(added).toEqual(['DELETE']);
  });
});

describe('rollback', () => {
  it('returns every granted table to append-only', async () => {
    await db.query(FORWARD);
    await db.query(ROLLBACK);
    for (const table of GRANTED_TABLES) {
      expect(await deleteGrantees(table), table).not.toContain('fibreflow_user');
    }
  });

  it('leaves SELECT and INSERT intact — it revokes DELETE, not access', async () => {
    await db.query(FORWARD);
    await db.query(ROLLBACK);
    const { rows } = await db.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = $1 AND table_name = 'fleet_operational_incident_actions' AND grantee = 'fibreflow_user'
        ORDER BY privilege_type`, [SCHEMA],
    );
    expect(rows.map((row) => row.privilege_type)).toEqual(['INSERT', 'SELECT']);
  });

  it('is repeatable', async () => {
    await expect(db.query(ROLLBACK)).resolves.toBeTruthy();
  });
});

describe('who may apply it', () => {
  /**
   * Production owns these tables as `postgres` and connects
   * MIGRATION_DATABASE_URL as `postgres`, so the runner is the owner and this
   * migration applies normally. This proves the other half — that a runner
   * which is NOT the owner (e.g. `migration_admin`, which is neither superuser
   * nor a member of the owner) fails loudly rather than silently no-opping.
   */
  it('fails loudly when the runner does not own the tables', async () => {
    const client = await nonOwner.connect();
    try {
      await expect(client.query(FORWARD)).rejects.toMatchObject({ code: '42501' });
    } finally {
      client.release();
    }
    expect(await deleteGrantees('fleet_operational_incidents')).not.toContain('fibreflow_user');
  });

  it('applies cleanly for the table owner', async () => {
    await expect(db.query(FORWARD)).resolves.toBeTruthy();
    expect(await deleteGrantees('fleet_operational_incidents')).toContain('fibreflow_user');
  });
});

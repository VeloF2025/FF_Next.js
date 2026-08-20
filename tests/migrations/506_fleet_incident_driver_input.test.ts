/**
 * Real-Postgres contract for migration 506 (Fleet incident driver input).
 * Mirrors 505's harness: apply the real migration SQL into a disposable
 * schema, exercise it against a live Postgres, then roll back.
 *
 * Every assertion here is deliberately one a mocked-Postgres unit test cannot
 * make. The unit suite stubs `pg`, so column-level GRANTs, CHECK constraints
 * and silent identifier truncation are all invisible to it — three Criticals
 * during this work were exactly that class of defect. 506 is applied on top of
 * 505 rather than in isolation, because 506's whole visibility/actor extension
 * is an ALTER of 505's tables and the pair has to compose.
 */
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const SCHEMA = 'mig506_fleet_incident_driver_input_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD_505 = readFileSync(join(SQL_DIR, '505_fleet_operational_incidents.sql'), 'utf8');
const FORWARD = readFileSync(join(SQL_DIR, '506_fleet_incident_driver_input.sql'), 'utf8');
const ROLLBACK = readFileSync(join(SQL_DIR, 'rollback_506_fleet_incident_driver_input.sql'), 'utf8');

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 1 });

/** The six lifecycle columns 506 deliberately makes writable — and only these. */
const UPDATABLE_REQUEST_COLUMNS = [
  'superseded_at',
  'closed_at',
  'closure_reason',
  'delivery_attempted_count',
  'delivery_accepted_count',
  'delivery_failed_count',
];

const PREREQUISITES = `
  CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL UNIQUE);
  CREATE TABLE staff (id UUID PRIMARY KEY, full_name TEXT NOT NULL);
  CREATE TABLE projects (id UUID PRIMARY KEY, project_name TEXT NOT NULL);
  CREATE TABLE fleet_vehicles (id UUID PRIMARY KEY, registration_number TEXT);
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
  INSERT INTO users (id, email) VALUES ('${USER}', 'migration-506@example.test');
  INSERT INTO staff (id, full_name) VALUES ('${STAFF}', 'Migration Test Driver');
  INSERT INTO projects (id, project_name) VALUES ('${PROJECT}', 'Migration Test Project');
  INSERT INTO access_permissions (type, key, label) VALUES ('module', 'fleet', 'Fleet');
`;

const REQUESTS_TABLE = `${SCHEMA}.fleet_incident_driver_input_requests`;

let incidentId = '';
/** An action row written under 505, before 506 existed. */
let legacyActionId = '';

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  // Owned by public, not the scratch schema — see 497's note: installing
  // btree_gist into a scratch schema ties its lifetime to this file's
  // DROP SCHEMA CASCADE and breaks whichever sibling test runs next.
  await admin.query('CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA public');
  // 505 and 506 both end in GRANT/REVOKE against fibreflow_user, which exists
  // on the real database but not in a fresh cluster. Roles are cluster-global,
  // so create it once and deliberately do not drop it — same approach as 505.
  await admin.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fibreflow_user') THEN
        CREATE ROLE fibreflow_user NOLOGIN;
      END IF;
    END $$;`);
  await db.query(PREREQUISITES);
  await db.query(FORWARD_505);

  // Seed a row that predates 506, so the "existing rows are not retroactively
  // disclosed" guarantee is tested on a genuinely pre-existing row rather than
  // on one written after the column already had its default.
  const incident = await db.query<{ id: string }>(
    `INSERT INTO fleet_operational_incidents
       (incident_reference, incident_type, severity, staff_id, detected_at, evidence_snapshot)
     VALUES ('INC-MIG506-0001', 'late', 'high', $1, '2026-08-18T06:00:00.000Z', '{}'::jsonb)
     RETURNING id`,
    [STAFF],
  );
  incidentId = incident.rows[0]!.id;
  const legacy = await db.query<{ id: string }>(
    `INSERT INTO fleet_operational_incident_actions (incident_id, action_type, actor_user_id, note)
     VALUES ($1, 'commented', $2, 'Written before 506 was applied') RETURNING id`,
    [incidentId, USER],
  );
  legacyActionId = legacy.rows[0]!.id;

  await db.query(FORWARD);
});

afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

describe('migration 506 identifier lengths', () => {
  it('keeps every constraint name under 63 bytes, unshortened by Postgres', async () => {
    const { rows } = await db.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE connamespace = $1::regnamespace
         AND conrelid::regclass::text LIKE 'fleet_incident%'`,
      [SCHEMA],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const { conname } of rows) {
      // Postgres truncates silently at NAMEDATALEN-1 and reports no error, so a
      // name that arrived at exactly 63 bytes is indistinguishable from one that
      // was cut down to fit. The longest here is 62 — one byte of headroom.
      expect(Buffer.byteLength(conname, 'utf8')).toBeLessThan(63);
    }
  });
});

describe('migration 506 request table is append-only except its bookkeeping', () => {
  it('grants UPDATE on exactly the six lifecycle columns and no others', async () => {
    const { rows } = await db.query<{ column_name: string; updatable: boolean }>(
      `SELECT column_name,
              has_column_privilege('fibreflow_user', $1::regclass, column_name, 'UPDATE') AS updatable
       FROM information_schema.columns
       WHERE table_schema = $2 AND table_name = 'fleet_incident_driver_input_requests'`,
      [REQUESTS_TABLE, SCHEMA],
    );
    expect(rows.length).toBeGreaterThan(UPDATABLE_REQUEST_COLUMNS.length);
    const updatable = rows.filter((r) => r.updatable).map((r) => r.column_name).sort();
    expect(updatable).toEqual([...UPDATABLE_REQUEST_COLUMNS].sort());
  });

  it('refuses to let the guidance a manager sent be rewritten', async () => {
    // The point of the column-scoped grant: a blanket UPDATE would satisfy the
    // lifecycle need and quietly also permit rewriting the request itself.
    const { rows } = await db.query<{ can: boolean }>(
      `SELECT has_column_privilege('fibreflow_user', $1::regclass, 'guidance', 'UPDATE') AS can`,
      [REQUESTS_TABLE],
    );
    expect(rows[0]!.can).toBe(false);
  });

  it('grants no UPDATE at all on submissions or correction links', async () => {
    const tables = ['fleet_incident_driver_submissions', 'fleet_incident_attendance_correction_links'];
    for (const table of tables) {
      const { rows } = await db.query<{ can: boolean }>(
        `SELECT has_table_privilege('fibreflow_user', $1::regclass, 'UPDATE') AS can`,
        [`${SCHEMA}.${table}`],
      );
      expect({ table, can: rows[0]!.can }).toEqual({ table, can: false });
    }
  });
});

describe('migration 506 visibility', () => {
  it('leaves rows written before it was applied internal', async () => {
    const { rows } = await db.query<{ visibility: string }>(
      'SELECT visibility FROM fleet_operational_incident_actions WHERE id = $1',
      [legacyActionId],
    );
    expect(rows[0]!.visibility).toBe('internal');
  });

  it('rejects a visibility value outside the three the design defines', async () => {
    await expect(
      db.query(
        `INSERT INTO fleet_operational_incident_actions (incident_id, action_type, actor_user_id, note, visibility)
         VALUES ($1, 'commented', $2, 'note', 'public')`,
        [incidentId, USER],
      ),
    ).rejects.toThrow(/visibility_check/);
  });
});

describe('migration 506 driver response action', () => {
  it('accepts a driver response exactly as submissionService writes it', async () => {
    // The end-to-end proof of the defect the product-level review found: the
    // driver's own words are stored verbatim on an action row, attributed to a
    // staff member who may have no user account at all. Under 505's original
    // actor CHECK this insert was impossible — actor_user_id was mandatory
    // whenever is_system_actor was false.
    const explanation = 'I was collecting materials from the depot before site.';
    const { rows } = await db.query<{ note: string; visibility: string }>(
      `INSERT INTO fleet_operational_incident_actions
         (incident_id, action_type, actor_staff_id, is_system_actor, note, visibility)
       VALUES ($1, 'driver_response_received', $2, false, $3, 'driver_submitted')
       RETURNING note, visibility`,
      [incidentId, STAFF, explanation],
    );
    expect(rows[0]).toEqual({ note: explanation, visibility: 'driver_submitted' });
  });

  it('still demands exactly one actor, so an action can never be doubly attributed', async () => {
    await expect(
      db.query(
        `INSERT INTO fleet_operational_incident_actions
           (incident_id, action_type, actor_user_id, actor_staff_id, is_system_actor, note)
         VALUES ($1, 'commented', $2, $3, false, 'two actors')`,
        [incidentId, USER, STAFF],
      ),
    ).rejects.toThrow(/actor_check/);
  });
});

describe('migration 506 rollback', () => {
  it('removes its tables and restores the narrower action-type constraint', async () => {
    await db.query(ROLLBACK);
    const { rows } = await db.query<{ present: boolean }>(
      'SELECT to_regclass($1) IS NOT NULL AS present',
      [REQUESTS_TABLE],
    );
    expect(rows[0]!.present).toBe(false);
    await expect(
      db.query(
        `INSERT INTO fleet_operational_incident_actions (incident_id, action_type, actor_user_id, note)
         VALUES ($1, 'driver_response_received', $2, 'no longer legal')`,
        [incidentId, USER],
      ),
    ).rejects.toThrow(/type_check/);
  });
});

/**
 * Real-Postgres contract for migration 499 (Fleet operational incidents).
 * Mirrors 497/498's pattern: apply the real migration SQL into a disposable
 * schema, exercise its constraints against a live Postgres, then roll back.
 *
 * The identifier-length assertion below is the direct regression check for
 * this migration's fix: two CONSTRAINT names originally exceeded Postgres's
 * 63-byte NAMEDATALEN limit and were silently truncated at CREATE TABLE —
 * a defect that a string-only test (migrationContract.test.ts) cannot catch,
 * because truncation is silent and produces no error unless two names
 * collide. Querying pg_constraint after applying the real migration is the
 * only way to prove the names survived intact.
 */
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const SCHEMA = 'mig499_fleet_operational_incidents_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD = readFileSync(join(SQL_DIR, '499_fleet_operational_incidents.sql'), 'utf8');
const ROLLBACK = readFileSync(join(SQL_DIR, 'rollback_499_fleet_operational_incidents.sql'), 'utf8');

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 1 });

const PREREQUISITES = `
  CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL UNIQUE);
  CREATE TABLE staff (id UUID PRIMARY KEY, full_name TEXT NOT NULL);
  CREATE TABLE projects (id UUID PRIMARY KEY, project_name TEXT NOT NULL);
  CREATE TABLE fleet_vehicles (id UUID PRIMARY KEY, registration_number TEXT);
  CREATE TABLE fleet_project_operational_sites (id UUID PRIMARY KEY);
  CREATE TABLE fleet_operational_status_rules (id UUID PRIMARY KEY);
  CREATE TABLE fleet_operational_assignments (id UUID PRIMARY KEY);
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
  INSERT INTO users (id, email) VALUES ('${USER}', 'migration-499@example.test');
  INSERT INTO staff (id, full_name) VALUES ('${STAFF}', 'Migration Test Staff');
  INSERT INTO projects (id, project_name) VALUES ('${PROJECT}', 'Migration Test Project');
  INSERT INTO access_permissions (type, key, label) VALUES ('module', 'fleet', 'Fleet');
`;

let referenceCounter = 0;
function nextReference(): string {
  referenceCounter += 1;
  return `INC-MIG499-${String(referenceCounter).padStart(4, '0')}`;
}

async function insertIncident(overrides: Record<string, unknown> = {}): Promise<string> {
  const values = {
    incidentReference: nextReference(), incidentType: 'late', severity: 'high', detectedAt: '2026-08-18T06:00:00.000Z',
    evidenceSnapshot: '{}', ...overrides,
  };
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO fleet_operational_incidents
       (incident_reference, incident_type, severity, staff_id, detected_at, evidence_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
    [values.incidentReference, values.incidentType, values.severity, STAFF, values.detectedAt, values.evidenceSnapshot],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  // Owned by public, not the scratch schema — see the note in
  // 497_fleet_operational_assignments.test.ts: installing btree_gist into a
  // scratch schema ties its lifetime to this file's DROP SCHEMA CASCADE and
  // breaks whichever sibling migration test runs next in the shared container.
  await admin.query('CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA public');
  await db.query(PREREQUISITES);
  await db.query(FORWARD);
});

afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

beforeEach(async () => {
  await db.query(`TRUNCATE fleet_operational_incident_evidence, fleet_operational_incident_actions,
    fleet_operational_incident_observations, fleet_operational_incidents`);
});

describe('migration 499 identifier lengths', () => {
  // The direct regression check: both constraints this fix shortened must
  // exist under their new, exact names — if either were still 64/67 bytes,
  // Postgres would have silently truncated it and this equality would fail.
  it('keeps every constraint name on the incident tables under 63 bytes, unshortened by Postgres', async () => {
    const { rows } = await db.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conrelid IN ('fleet_operational_incident_observations'::regclass, 'fleet_operational_incidents'::regclass)`,
    );
    const names = rows.map((row) => row.conname);
    expect(names).toContain('fleet_operational_incident_observations_evidence_snapshot_obj');
    expect(names).toContain('fleet_operational_incident_observations_fingerprint_unique');
    for (const name of names) {
      expect(Buffer.byteLength(name, 'utf8')).toBeLessThanOrEqual(63);
    }
  });
});

describe('migration 499 fleet_operational_incidents invariants', () => {
  it('enforces the lifecycle_details_check pairing status with its actor/time fields', async () => {
    await expect(insertIncident()).resolves.toBeDefined(); // open, no actor fields: allowed
    await expect(db.query(
      `INSERT INTO fleet_operational_incidents (incident_reference, incident_type, severity, detected_at, lifecycle_status)
       VALUES ($1, 'late', 'high', now(), 'acknowledged')`,
      [nextReference()],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects a non-object evidence_snapshot', async () => {
    await expect(insertIncident({ evidenceSnapshot: '[]' })).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces the terminal_outcome_check pairing lifecycle_status with allowed outcomes', async () => {
    // Fully resolved-shaped row (satisfies lifecycle_details_check) but with an
    // outcome only valid for 'dismissed' — must trip terminal_outcome_check.
    await expect(db.query(
      `INSERT INTO fleet_operational_incidents (
         incident_reference, incident_type, severity, detected_at, lifecycle_status,
         acknowledged_by, acknowledged_at, review_started_by, review_started_at,
         resolved_by, resolved_at, outcome, resolution_note
       ) VALUES ($1, 'late', 'high', now(), 'resolved', $2, now(), $2, now(), $2, now(), 'duplicate', 'note')`,
      [nextReference(), USER],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces the duplicate_link_check requiring a link only for a duplicate outcome', async () => {
    await expect(db.query(
      `INSERT INTO fleet_operational_incidents (
         incident_reference, incident_type, severity, detected_at, lifecycle_status,
         acknowledged_by, acknowledged_at, review_started_by, review_started_at,
         resolved_by, resolved_at, outcome, resolution_note
       ) VALUES ($1, 'late', 'high', now(), 'dismissed', $2, now(), $2, now(), $2, now(), 'duplicate', 'note')`,
      [nextReference(), USER],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('requires a unique incident_reference', async () => {
    const reference = nextReference();
    await insertIncident({ incidentReference: reference });
    await expect(insertIncident({ incidentReference: reference })).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects a second open incident for the same staff/type/work-date/assignment combination', async () => {
    await db.query(`INSERT INTO fleet_operational_incidents
       (incident_reference, incident_type, severity, staff_id, detected_at, work_date)
       VALUES ($1, 'late', 'high', $2, now(), '2026-08-18')`, [nextReference(), STAFF]);
    await expect(db.query(`INSERT INTO fleet_operational_incidents
       (incident_reference, incident_type, severity, staff_id, detected_at, work_date)
       VALUES ($1, 'late', 'high', $2, now(), '2026-08-18')`, [nextReference(), STAFF]))
      .rejects.toMatchObject({ code: '23505' });
  });

  it('rejects a second incident for the same (incident_type, source_event_id) pair', async () => {
    await db.query(`INSERT INTO fleet_operational_incidents
       (incident_reference, incident_type, severity, detected_at, source_event_id)
       VALUES ($1, 'accident_sos', 'critical', now(), 'evt-1')`, [nextReference()]);
    await expect(db.query(`INSERT INTO fleet_operational_incidents
       (incident_reference, incident_type, severity, detected_at, source_event_id)
       VALUES ($1, 'accident_sos', 'critical', now(), 'evt-1')`, [nextReference()]))
      .rejects.toMatchObject({ code: '23505' });
  });
});

describe('migration 499 child-table invariants', () => {
  it('enforces the observations fingerprint_unique constraint per incident (the renamed constraint)', async () => {
    const incidentId = await insertIncident();
    await db.query(`INSERT INTO fleet_operational_incident_observations (incident_id, observation_fingerprint, observed_at)
      VALUES ($1, 'fp-1', now())`, [incidentId]);
    await expect(db.query(`INSERT INTO fleet_operational_incident_observations (incident_id, observation_fingerprint, observed_at)
      VALUES ($1, 'fp-1', now())`, [incidentId])).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects a non-object observation evidence_snapshot (the renamed constraint)', async () => {
    const incidentId = await insertIncident();
    await expect(db.query(`INSERT INTO fleet_operational_incident_observations
      (incident_id, observation_fingerprint, observed_at, evidence_snapshot) VALUES ($1, 'fp-2', now(), '[]'::jsonb)`,
      [incidentId])).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces the actions actor_check (exactly one of actor_user_id or is_system_actor)', async () => {
    const incidentId = await insertIncident();
    await expect(db.query(`INSERT INTO fleet_operational_incident_actions
      (incident_id, action_type, actor_user_id, is_system_actor) VALUES ($1, 'opened', $2, true)`,
      [incidentId, USER])).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces the actions note_check requiring a non-blank note on commented/resolved/dismissed', async () => {
    const incidentId = await insertIncident();
    await expect(db.query(`INSERT INTO fleet_operational_incident_actions
      (incident_id, action_type, actor_user_id, is_system_actor) VALUES ($1, 'commented', $2, false)`,
      [incidentId, USER])).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces the evidence storage_nonblank constraint', async () => {
    const incidentId = await insertIncident();
    await expect(db.query(`INSERT INTO fleet_operational_incident_evidence
      (incident_id, storage_url, storage_key, evidence_type) VALUES ($1, '', 'key-1', 'photo')`,
      [incidentId])).rejects.toMatchObject({ code: '23514' });
  });
});

describe('migration 499 seed data and permissions', () => {
  it('seeds exactly the 14 approved incident types at version 1', async () => {
    const { rows } = await db.query<{ incident_type: string; severity: string }>(
      `SELECT incident_type, severity FROM fleet_operational_incident_rules WHERE version = 1 ORDER BY incident_type`,
    );
    expect(rows).toHaveLength(14);
    expect(rows.find((row) => row.incident_type === 'accident_sos')!.severity).toBe('critical');
    expect(rows.find((row) => row.incident_type === 'late')!.severity).toBe('high');
  });

  // Locked product decision (this task's brief, Fix 1/Fix 7): manager and
  // project_manager get base fleet.incidents only; fleet.incidents-settings
  // (rules/oversight membership) is admin/super_admin only.
  it('grants fleet.incidents to manager/project_manager but fleet.incidents-settings to admin roles only', async () => {
    const { rows } = await db.query<{ key: string; role: string }>(
      `SELECT p.key, r.role FROM access_permissions p JOIN role_permissions r ON r.permission_key = p.key
       WHERE p.key IN ('fleet.incidents', 'fleet.incidents-settings') ORDER BY p.key, r.role`,
    );
    expect(rows.filter((row) => row.key === 'fleet.incidents').map((row) => row.role))
      .toEqual(['admin', 'manager', 'project_manager', 'super_admin']);
    expect(rows.filter((row) => row.key === 'fleet.incidents-settings').map((row) => row.role))
      .toEqual(['admin', 'super_admin']);
  });
});

describe('migration 499 rollback', () => {
  it('removes only its tables and permission rows', async () => {
    await db.query(`INSERT INTO schema_migrations (filename) VALUES ('499_fleet_operational_incidents.sql')`);
    await db.query(`INSERT INTO user_permission_overrides (user_id, permission_key, override_type, actions)
      VALUES ($1, 'fleet.incidents', 'grant', '{"view":true,"edit":true}')`, [USER]);
    await db.query(ROLLBACK);

    const { rows } = await db.query<{
      rules: string | null; oversight: string | null; runs: string | null; incidents: string | null;
      observations: string | null; actions: string | null; evidence: string | null;
    }>(
      `SELECT to_regclass('fleet_operational_incident_rules') AS rules,
              to_regclass('fleet_operational_oversight_members') AS oversight,
              to_regclass('fleet_operational_monitor_runs') AS runs,
              to_regclass('fleet_operational_incidents') AS incidents,
              to_regclass('fleet_operational_incident_observations') AS observations,
              to_regclass('fleet_operational_incident_actions') AS actions,
              to_regclass('fleet_operational_incident_evidence') AS evidence`,
    );
    expect(rows[0]).toEqual({
      rules: null, oversight: null, runs: null, incidents: null, observations: null, actions: null, evidence: null,
    });
    await expect(db.query(`SELECT 1 FROM access_permissions WHERE key = 'fleet'`)).resolves.toBeDefined();
    await expect(db.query(`SELECT 1 FROM access_permissions WHERE key IN ('fleet.incidents', 'fleet.incidents-settings')`))
      .resolves.toMatchObject({ rows: [] });
    await expect(db.query(`SELECT 1 FROM role_permissions WHERE permission_key IN ('fleet.incidents', 'fleet.incidents-settings')`))
      .resolves.toMatchObject({ rows: [] });
    await expect(db.query(`SELECT 1 FROM user_permission_overrides WHERE permission_key = 'fleet.incidents'`))
      .resolves.toMatchObject({ rows: [] });
    await expect(db.query(
      `SELECT filename FROM schema_migrations WHERE filename LIKE '%_fleet_operational_incidents.sql'`,
    )).resolves.toMatchObject({ rows: [] });
  });
});

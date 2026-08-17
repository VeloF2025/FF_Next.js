/**
 * Real-Postgres contract for migration 497. The migration stores only explicit
 * expectations; source geometry and vehicle relationships stay in their own
 * tables. Every object below lives in a disposable schema.
 */
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { buildAssignmentRosterQuery } from '@/modules/fleet/assignments/rosterQueries';

const SCHEMA = 'mig497_fleet_operational_assignments_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(
  `-c search_path=${SCHEMA}`
)}`;
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD = readFileSync(join(SQL_DIR, '497_fleet_operational_assignments.sql'), 'utf8');
const ROLLBACK = readFileSync(
  join(SQL_DIR, 'rollback_497_fleet_operational_assignments.sql'),
  'utf8'
);

const PROJECT = '10000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000002';
const STAFF = '10000000-0000-4000-8000-000000000003';
const LOCATION = '10000000-0000-4000-8000-000000000004';
const AOI = '10000000-0000-4000-8000-000000000005';
const VEHICLE_ASSIGNMENT = '10000000-0000-4000-8000-000000000006';
const UNASSIGNED_STAFF = '10000000-0000-4000-8000-000000000007';
const UNASSIGNED_USER = '10000000-0000-4000-8000-000000000008';
const TEAM = '10000000-0000-4000-8000-000000000009';
const POLICY = '10000000-0000-4000-8000-000000000010';

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 1 });

const PREREQUISITES = `
  CREATE TABLE schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL UNIQUE);
  CREATE TABLE staff (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id), full_name TEXT NOT NULL,
    first_name TEXT, last_name TEXT, status TEXT DEFAULT 'active', is_active BOOLEAN DEFAULT true,
    home_site_id UUID);
  CREATE TABLE projects (id UUID PRIMARY KEY, project_name TEXT NOT NULL, project_code TEXT,
    status TEXT DEFAULT 'active');
  CREATE TABLE fno_atlas_project_aois (id UUID PRIMARY KEY);
  CREATE TABLE fleet_authorized_locations (id UUID PRIMARY KEY, name TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true);
  CREATE TABLE fleet_vehicles (id UUID PRIMARY KEY, registration_number TEXT, status TEXT);
  CREATE TABLE vehicle_assignments (id UUID PRIMARY KEY, staff_id UUID NOT NULL REFERENCES staff(id),
    fleet_vehicle_id UUID, assignment_start DATE, assignment_end DATE);
  CREATE TABLE fleet_vehicle_project_assignments (id UUID PRIMARY KEY, vehicle_id UUID, project_id UUID,
    is_active BOOLEAN, assigned_date DATE, returned_date DATE);
  CREATE TABLE attendance_policies (id UUID PRIMARY KEY, is_active BOOLEAN, start_time TIME, end_time TIME,
    work_days JSONB);
  CREATE TABLE attendance_policy_assignments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), staff_id UUID,
    policy_id UUID, effective_from DATE, effective_to DATE);
  CREATE TABLE teams (id UUID PRIMARY KEY, team_name TEXT, is_active BOOLEAN, team_type TEXT);
  CREATE TABLE team_members (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), team_id UUID, user_id UUID,
    is_active BOOLEAN);
  CREATE TABLE project_team_assignments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID,
    team_id UUID, role TEXT);
  CREATE TABLE access_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), type VARCHAR(20) NOT NULL,
    key VARCHAR(100) UNIQUE NOT NULL, parent_key VARCHAR(100), label VARCHAR(100) NOT NULL,
    description TEXT, route VARCHAR(200), sort_order INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT TRUE
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
  INSERT INTO users (id, email) VALUES ('${USER}', 'migration-497@example.test'),
    ('${UNASSIGNED_USER}', 'migration-497-unassigned@example.test');
  INSERT INTO staff (id, user_id, full_name, first_name, last_name) VALUES
    ('${STAFF}', '${USER}', 'Migration Test Staff', 'Explicit', 'Driver'),
    ('${UNASSIGNED_STAFF}', '${UNASSIGNED_USER}', 'Unassigned Test Staff', 'Scheduled', 'Unassigned');
  INSERT INTO projects (id, project_name, project_code) VALUES ('${PROJECT}', 'Migration Test Project', 'M497');
  INSERT INTO fno_atlas_project_aois (id) VALUES ('${AOI}');
  INSERT INTO fleet_authorized_locations (id, name) VALUES ('${LOCATION}', 'Migration Test Location');
  INSERT INTO vehicle_assignments (id, staff_id) VALUES ('${VEHICLE_ASSIGNMENT}', '${STAFF}');
  INSERT INTO attendance_policies (id, is_active, start_time, end_time, work_days) VALUES
    ('${POLICY}', true, '08:00', '17:00', '{"monday":true}');
  INSERT INTO attendance_policy_assignments (staff_id, policy_id, effective_from) VALUES
    ('${STAFF}', '${POLICY}', '2026-01-01'), ('${UNASSIGNED_STAFF}', '${POLICY}', '2026-01-01');
  INSERT INTO teams (id, team_name, is_active, team_type) VALUES ('${TEAM}', 'Migration Team', true, 'internal');
  INSERT INTO team_members (team_id, user_id, is_active) VALUES ('${TEAM}', '${UNASSIGNED_USER}', true);
  INSERT INTO project_team_assignments (project_id, team_id, role) VALUES ('${PROJECT}', '${TEAM}', 'other');
  INSERT INTO access_permissions (type, key, label) VALUES ('module', 'fleet', 'Fleet');
`;

type SiteInput = { aoiId: string | null; locationId: string | null; isDefault?: boolean };

async function insertSite({ aoiId, locationId, isDefault = false }: SiteInput): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO fleet_project_operational_sites
       (project_id, display_name, project_aoi_id, authorized_location_id, is_default, created_by)
     VALUES ($1, 'Operational Site', $2, $3, $4, $5) RETURNING id`,
    [PROJECT, aoiId, locationId, isDefault, USER]
  );
  return rows[0]!.id;
}

async function insertSecondDefaultSite(): Promise<string> {
  await insertSite({ aoiId: AOI, locationId: null, isDefault: true });
  return insertSite({ aoiId: null, locationId: LOCATION, isDefault: true });
}

type AssignmentInput = {
  siteId: string;
  startDate?: string;
  endDate?: string;
  assignmentKind?: 'roster' | 'daily_override';
  reason?: string | null;
  status?: 'active' | 'superseded' | 'ended';
};

async function insertAssignment({
  siteId,
  startDate = '2026-08-10',
  endDate = '2026-08-12',
  assignmentKind = 'roster',
  reason = null,
  status = 'active',
}: AssignmentInput): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO fleet_operational_assignments
       (staff_id, project_id, operational_site_id, start_date, end_date, assignment_kind,
        vehicle_assignment_id, status, reason, project_name_snapshot, project_code_snapshot,
        operational_site_display_name_snapshot, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Migration Test Project', 'M497',
             'Operational Site', $10)
     RETURNING id`,
    [
      STAFF,
      PROJECT,
      siteId,
      startDate,
      endDate,
      assignmentKind,
      VEHICLE_ASSIGNMENT,
      status,
      reason,
      USER,
    ]
  );
  return rows[0]!.id;
}

async function insertOverlappingAssignment(): Promise<string> {
  const siteId = await insertSite({ aoiId: AOI, locationId: null });
  await insertAssignment({ siteId, startDate: '2026-08-10', endDate: '2026-08-12' });
  return insertAssignment({ siteId, startDate: '2026-08-12', endDate: '2026-08-15' });
}

async function insertDailyOverrideWithRange(): Promise<string> {
  const siteId = await insertSite({ aoiId: AOI, locationId: null });
  return insertAssignment({
    siteId,
    startDate: '2026-08-10',
    endDate: '2026-08-11',
    assignmentKind: 'daily_override',
    reason: 'Covering an outage',
  });
}

async function insertDailyOverrideWithoutReason(): Promise<string> {
  const siteId = await insertSite({ aoiId: AOI, locationId: null });
  return insertAssignment({
    siteId,
    startDate: '2026-08-10',
    endDate: '2026-08-10',
    assignmentKind: 'daily_override',
    reason: '   ',
  });
}

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await db.query(PREREQUISITES);
  await db.query(FORWARD);
});

afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

beforeEach(async () => {
  await db.query(`TRUNCATE fleet_operational_assignment_audit, fleet_project_operational_site_audit,
    fleet_operational_assignments, fleet_project_operational_sites`);
});

describe('migration 497 operational-assignment invariants', () => {
  it('requires exactly one source for an operational site', async () => {
    await expect(insertSite({ aoiId: null, locationId: null })).rejects.toMatchObject({ code: '23514' });
    await expect(insertSite({ aoiId: AOI, locationId: LOCATION })).rejects.toMatchObject({ code: '23514' });
  });

  it('allows only one active default site per project', async () => {
    await expect(insertSecondDefaultSite()).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects duplicate active project/source mappings', async () => {
    await insertSite({ aoiId: AOI, locationId: null });
    await expect(insertSite({ aoiId: AOI, locationId: null })).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects overlapping active assignments for the same staff member', async () => {
    await expect(insertOverlappingAssignment()).rejects.toMatchObject({ code: '23P01' });
  });

  // The exclusion constraints are scoped per assignment_kind so the documented
  // precedence is reachable: a one-day override must be insertable on a day the
  // roster already covers, or the resolver's daily_override branch is dead code.
  it('allows a daily override to overlap an active roster assignment', async () => {
    const siteId = await insertSite({ aoiId: AOI, locationId: null });
    const rosterId = await insertAssignment({ siteId, startDate: '2026-08-10', endDate: '2026-08-14' });
    const overrideId = await insertAssignment({
      siteId,
      startDate: '2026-08-12',
      endDate: '2026-08-12',
      assignmentKind: 'daily_override',
      reason: 'Covering a callout',
    });

    // Positive pin: BOTH rows are simultaneously active, which is the state the
    // resolver's precedence ordering requires in order to prefer the override.
    const { rows } = await db.query<{ id: string; assignment_kind: string }>(
      `SELECT id, assignment_kind FROM fleet_operational_assignments
       WHERE status = 'active' AND staff_id = $1 ORDER BY assignment_kind`,
      [STAFF]
    );
    expect(rows.map((row) => row.assignment_kind)).toEqual(['daily_override', 'roster']);
    expect(rows.map((row) => row.id).sort()).toEqual([rosterId, overrideId].sort());
  });

  it('still rejects two active daily overrides on the same day', async () => {
    const siteId = await insertSite({ aoiId: AOI, locationId: null });
    await insertAssignment({
      siteId,
      startDate: '2026-08-12',
      endDate: '2026-08-12',
      assignmentKind: 'daily_override',
      reason: 'First override',
    });

    await expect(insertAssignment({
      siteId,
      startDate: '2026-08-12',
      endDate: '2026-08-12',
      assignmentKind: 'daily_override',
      reason: 'Second override',
    })).rejects.toMatchObject({ code: '23P01' });
  });

  it('allows non-overlapping and superseded assignment history', async () => {
    const siteId = await insertSite({ aoiId: AOI, locationId: null });
    await insertAssignment({ siteId, startDate: '2026-08-10', endDate: '2026-08-12' });
    await expect(insertAssignment({ siteId, startDate: '2026-08-13', endDate: '2026-08-15' })).resolves.toBeDefined();
    await expect(insertAssignment({ siteId, status: 'superseded' })).resolves.toBeDefined();
  });

  it('requires a daily override to cover one day', async () => {
    await expect(insertDailyOverrideWithRange()).rejects.toMatchObject({ code: '23514' });
  });

  it('requires a daily override reason that is not blank', async () => {
    await expect(insertDailyOverrideWithoutReason()).rejects.toMatchObject({ code: '23514' });
  });

  it('accepts append-only site and assignment audit evidence', async () => {
    const siteId = await insertSite({ aoiId: AOI, locationId: null });
    const assignmentId = await insertAssignment({ siteId });
    await expect(
      db.query(
        `INSERT INTO fleet_project_operational_site_audit
           (operational_site_id, action, actor_user_id, after_snapshot)
         VALUES ($1, 'created', $2, '{"display_name":"Operational Site"}')`,
        [siteId, USER]
      )
    ).resolves.toBeDefined();
    await expect(
      db.query(
        `INSERT INTO fleet_operational_assignment_audit
           (assignment_id, action, actor_user_id, request_correlation_id, after_snapshot)
         VALUES ($1, 'created', $2, 'migration-497-contract', '{"assignment_kind":"roster"}')`,
        [assignmentId, USER]
      )
    ).resolves.toBeDefined();
  });

  it('registers fleet.assignments under the Fleet parent with Fleet role grants', async () => {
    const { rows } = await db.query<{ parent_key: string; role: string; actions: { view: boolean; edit: boolean; delete: boolean } }>(
      `SELECT p.parent_key, r.role, r.actions
       FROM access_permissions p JOIN role_permissions r ON r.permission_key = p.key
       WHERE p.key = 'fleet.assignments' ORDER BY r.role`
    );
    expect(rows.map((row) => row.role)).toEqual(['admin', 'manager', 'super_admin', 'viewer']);
    expect(rows.every((row) => row.parent_key === 'fleet')).toBe(true);
    expect(rows.find((row) => row.role === 'viewer')!.actions).toMatchObject({ view: true, edit: false });
    expect(rows.find((row) => row.role === 'manager')!.actions).toMatchObject({ view: true, edit: true });
    expect(rows.every((row) => row.actions.delete === false)).toBe(true);
  });
});

describe('effective roster production SQL', () => {
  it('executes explicit precedence with Attendance schedule state', async () => {
    const siteId = await insertSite({ aoiId: AOI, locationId: null });
    await db.query(`UPDATE staff SET home_site_id = $1 WHERE id = $2`, [LOCATION, STAFF]);
    await insertAssignment({ siteId, startDate: '2026-08-17', endDate: '2026-08-17' });
    const built = buildAssignmentRosterQuery({ projectId: PROJECT, startDate: '2026-08-17', endDate: '2026-08-17' });
    const { rows } = await db.query<{ staff_id: string; assignment_kind: string; operational_site_id: string; scheduled: boolean; expected_start_time: string }>(built.text, built.params);

    expect(rows).toEqual([expect.objectContaining({
      staff_id: STAFF,
      assignment_kind: 'roster',
      operational_site_id: siteId,
      scheduled: true,
      expected_start_time: '08:00:00',
    })]);
  });

  it('executes the scheduled-unassigned project-team scope branch', async () => {
    const built = buildAssignmentRosterQuery({ projectId: PROJECT, source: 'unassigned', unassignedScheduled: true,
      startDate: '2026-08-17', endDate: '2026-08-17' });
    const { rows } = await db.query<{ staff_id: string; assignment_kind: string; scheduled: boolean }>(built.text, built.params);

    expect(rows).toEqual([expect.objectContaining({ staff_id: UNASSIGNED_STAFF, assignment_kind: 'unassigned', scheduled: true })]);
  });
});

describe('migration 497 rollback', () => {
  it('removes only its tables and permission rows', async () => {
    await db.query(`INSERT INTO schema_migrations (filename) VALUES ('497_fleet_operational_assignments.sql')`);
    await db.query(
      `INSERT INTO user_permission_overrides (user_id, permission_key, override_type, actions)
       VALUES ($1, 'fleet.assignments', 'grant', '{"view":true,"edit":true}')`,
      [USER]
    );
    await db.query(ROLLBACK);

    const { rows } = await db.query<{ site: string | null; assignment: string | null; site_audit: string | null; assignment_audit: string | null }>(
      `SELECT to_regclass('fleet_project_operational_sites') AS site,
              to_regclass('fleet_operational_assignments') AS assignment,
              to_regclass('fleet_project_operational_site_audit') AS site_audit,
              to_regclass('fleet_operational_assignment_audit') AS assignment_audit`
    );
    expect(rows[0]).toEqual({ site: null, assignment: null, site_audit: null, assignment_audit: null });
    await expect(db.query(`SELECT 1 FROM access_permissions WHERE key = 'fleet'`)).resolves.toBeDefined();
    await expect(db.query(`SELECT 1 FROM access_permissions WHERE key = 'fleet.assignments'`)).resolves.toMatchObject({ rows: [] });
    await expect(db.query(`SELECT 1 FROM role_permissions WHERE permission_key = 'fleet.assignments'`)).resolves.toMatchObject({ rows: [] });
    await expect(db.query(`SELECT 1 FROM user_permission_overrides WHERE permission_key = 'fleet.assignments'`)).resolves.toMatchObject({ rows: [] });
    // The tracking row must go too, or the runner still believes this migration
    // is applied while its schema is gone. The rollback's DELETE targeted the
    // pre-rename filename after the 488 -> 497 renumber, so it matched nothing —
    // and this test asserted only on tables and permissions, so it passed either
    // way. Pinning the filename here is what makes the rename honest.
    await expect(db.query(
      `SELECT filename FROM schema_migrations WHERE filename LIKE '%_fleet_operational_assignments.sql'`
    )).resolves.toMatchObject({ rows: [] });
    const extension = await db.query<{ present: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') AS present`
    );
    expect(extension.rows[0]!.present).toBe(true);
  });
});

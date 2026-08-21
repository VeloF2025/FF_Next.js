/**
 * The assignment preview/commit SQL, executed against a real Postgres.
 *
 * `loadPreviewState` is reached by five live routes — preview.ts, commit.ts,
 * [assignmentId].ts, [assignmentId]/history.ts and copy-preview.ts — and its
 * source-version query read `MAX(updated_at) FROM attendance_policy_assignments`.
 * That relation has never existed in any schema, so fleet assignment preview and
 * commit both threw in production while CI stayed green: every test of this
 * module drives it through a stub client that records SQL text and never sends
 * it. This file sends it.
 *
 * Two things are pinned, and both are load-bearing:
 *
 *   1. The version query runs. It now reads `attendance_schedule_policies`,
 *      which has `created_at` and NO `updated_at` — using MAX(updated_at) there
 *      would be a 42703, so this catches that mistake too.
 *   2. The lock path runs with `lock = true`, which is what commit.ts uses.
 *      The per-staff `FOR UPDATE` on the phantom table was deleted rather than
 *      repointed; if anyone reinstates it against either name, this fails.
 *
 * SEED FIDELITY IS THE POINT. Every column below was read out of
 * information_schema on production. Do not add a column here to make a failure
 * go away — check the real database first. Fixtures inventing
 * `fleet_vehicles.registration_number` are what hid this class of bug for
 * months (see 512's header).
 *
 * SAFETY / ISOLATION: everything lives in a scratch schema reached through the
 * connection string's `options=-c search_path=...`, so the unqualified service
 * SQL resolves there and never touches the shared public schema.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
      'See .env.local.example.'
  );
}

const SCHEMA = 'mig513_preview_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(
  `-c search_path=${SCHEMA}`
)}`;
process.env.DATABASE_URL = SCOPED_URL;

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import type { AssignmentProposalRow } from '@/modules/fleet/assignments/types';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const SITE = '22222222-2222-4222-8222-222222222222';
const STAFF = '33333333-3333-3333-3333-333333333333';
const VEHICLE = '44444444-4444-4444-4444-444444444444';
const VEHICLE_ASSIGNMENT = '55555555-5555-4555-8555-555555555555';
const TEAM = '66666666-6666-4666-8666-666666666666';
const USER = '77777777-7777-4777-8777-777777777777';

/** Live production shapes. Subset of columns; exact names and types. */
const REAL_TABLES = `
  CREATE TABLE projects (
    id UUID PRIMARY KEY, project_name VARCHAR(255) NOT NULL, project_code VARCHAR(50),
    status VARCHAR(50), updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE staff (
    id UUID PRIMARY KEY, first_name VARCHAR(100), last_name VARCHAR(100), user_id UUID,
    status VARCHAR(50), is_active BOOLEAN, updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE teams (
    id UUID PRIMARY KEY, name VARCHAR(255) NOT NULL, is_active BOOLEAN, team_type VARCHAR(50)
  );
  CREATE TABLE team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), team_id UUID NOT NULL, user_id UUID,
    is_active BOOLEAN, updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE fleet_vehicles (
    id UUID PRIMARY KEY, registration VARCHAR(20) NOT NULL, status VARCHAR(20),
    updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE vehicle_assignments (
    id UUID PRIMARY KEY, staff_id UUID NOT NULL, fleet_vehicle_id UUID,
    assignment_start DATE NOT NULL, assignment_end DATE, updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE fleet_vehicle_project_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id UUID NOT NULL, project_id UUID NOT NULL,
    assigned_date DATE NOT NULL, returned_date DATE, is_active BOOLEAN NOT NULL DEFAULT true
  );
  CREATE TABLE fleet_project_operational_sites (
    id UUID PRIMARY KEY, project_id UUID NOT NULL, display_name TEXT NOT NULL,
    project_aoi_id UUID, is_active BOOLEAN NOT NULL DEFAULT true,
    is_default BOOLEAN NOT NULL DEFAULT false, updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE fno_atlas_project_aois (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), site_code TEXT, area_name TEXT,
    confidence TEXT, retired_at TIMESTAMPTZ
  );
  CREATE TABLE fleet_operational_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), staff_id UUID NOT NULL, project_id UUID NOT NULL,
    operational_site_id UUID NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL,
    assignment_kind TEXT NOT NULL, vehicle_assignment_id UUID, status TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
  );
  -- created_at, and NO updated_at. The version query must not ask for one.
  CREATE TABLE attendance_schedule_policies (
    id UUID PRIMARY KEY, timezone TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
    active_from DATE NOT NULL, active_to DATE,
    weekday_start TIME NOT NULL DEFAULT '08:00', weekday_end TIME NOT NULL DEFAULT '17:00',
    late_alert_minutes INTEGER NOT NULL DEFAULT 15,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

const SEED = `
  INSERT INTO projects VALUES ('${PROJECT}', 'Preview Test Project', 'PTP', 'active');
  INSERT INTO staff (id, first_name, last_name, user_id, status, is_active)
    VALUES ('${STAFF}', 'Preview', 'Driver', '${USER}', 'active', true);
  INSERT INTO teams VALUES ('${TEAM}', 'Preview Team', true, 'internal');
  INSERT INTO team_members (team_id, user_id, is_active) VALUES ('${TEAM}', '${USER}', true);
  INSERT INTO fleet_vehicles VALUES ('${VEHICLE}', 'MW63YBGP', 'active');
  INSERT INTO vehicle_assignments (id, staff_id, fleet_vehicle_id, assignment_start)
    VALUES ('${VEHICLE_ASSIGNMENT}', '${STAFF}', '${VEHICLE}', '2026-01-01');
  INSERT INTO fleet_vehicle_project_assignments (vehicle_id, project_id, assigned_date)
    VALUES ('${VEHICLE}', '${PROJECT}', '2026-01-01');
  INSERT INTO fleet_project_operational_sites (id, project_id, display_name, is_default)
    VALUES ('${SITE}', '${PROJECT}', 'Preview Site', true);
  INSERT INTO attendance_schedule_policies (id, active_from)
    VALUES ('88888888-8888-4888-8888-888888888888', '2026-04-24');
`;

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const pool = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 2 });

/** The `Db` shape assignmentQueries injects, backed by the scratch schema. */
const db = {
  query: async <T>(text: string, params?: unknown[]): Promise<T[]> =>
    (await pool.query(text, params as unknown[])).rows as T[],
  queryOne: async <T>(text: string, params?: unknown[]): Promise<T | null> =>
    ((await pool.query(text, params as unknown[])).rows[0] as T) ?? null,
};

const proposal: AssignmentProposalRow = {
  staffId: STAFF, projectId: PROJECT, operationalSiteId: SITE,
  startDate: '2026-08-17', endDate: '2026-08-21', assignmentKind: 'roster',
  vehicleAssignmentId: VEHICLE_ASSIGNMENT, reason: null,
};

type Queries = typeof import('@/modules/fleet/assignments/assignmentQueries');
let queries: Queries;

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await pool.query(REAL_TABLES);
  await pool.query(SEED);
  queries = await import('@/modules/fleet/assignments/assignmentQueries');
});

afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

describe('loadPreviewState against a real database', () => {
  /** The preview path (preview.ts, [assignmentId].ts, history.ts, copy-preview.ts). */
  it('executes without locking and returns a source version', async () => {
    const state = await queries.loadPreviewState([proposal], db as never, false);
    expect(state.sourceVersion).toEqual(expect.any(String));
    expect(state.sourceVersion.length).toBeGreaterThan(0);
    expect(state.snapshots[PROJECT]).toMatchObject({
      projectName: 'Preview Test Project', projectCode: 'PTP',
    });
    expect(state.snapshots[PROJECT]!.sites[SITE]).toBe('Preview Site');
  });

  /** The commit path. `lock = true` adds the FOR UPDATE statement. */
  it('executes with locking enabled', async () => {
    await expect(queries.loadPreviewState([proposal], db as never, true)).resolves.toMatchObject({
      sourceVersion: expect.any(String),
    });
  });

  /**
   * The version query is the statement that was broken. Reading the policy
   * table's real timestamp column proves it is wired to something that exists —
   * `MAX(updated_at)` there is a 42703, and the phantom table is a 42P01.
   */
  it('derives the attendance component of the version from attendance_schedule_policies', async () => {
    const before = await queries.loadPreviewState([proposal], db as never, false);

    await pool.query(
      `INSERT INTO attendance_schedule_policies (id, active_from, created_at)
       VALUES (gen_random_uuid(), '2026-09-01', now() + interval '1 day')`
    );
    const after = await queries.loadPreviewState([proposal], db as never, false);

    expect(after.sourceVersion).not.toBe(before.sourceVersion);
  });
});

describe('lockRelevantPreviewSources against a real database', () => {
  it('locks only relations that exist', async () => {
    await expect(
      queries.lockRelevantPreviewSources(db as never, [proposal], [TEAM])
    ).resolves.toBeUndefined();
  });
});

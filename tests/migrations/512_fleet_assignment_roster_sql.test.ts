/**
 * The assignment-roster SQL, executed against a real Postgres.
 *
 * src/modules/fleet/assignments/__tests__/rosterQueries.test.ts mocks
 * `@/lib/db-pool` and asserts on the SQL *string*, so it is structurally blind
 * to anything Postgres decides at parse time. That is how `fv.registration_number`
 * shipped: `fleet_vehicles` has no such column — it is `registration` — and every
 * caller of buildAssignmentRosterQuery (the operations overview, map-overlay and
 * status APIs, and the 5-minute operational monitor) threw in production while CI
 * stayed green. The same blind spot hid `t.team_name` (the column is `teams.name`)
 * and two relations that do not exist in any schema,
 * `attendance_policy_assignments` and `attendance_policies`.
 *
 * SEED FIDELITY IS THE WHOLE POINT. Every table below mirrors the LIVE schema —
 * names and types read out of information_schema on production. 497, 498, 510 and
 * 511 all declared `fleet_vehicles.registration_number`, and those fixtures are
 * what made the wrong name look correct for as long as it did. Do not "fix" a
 * failure here by adding a column to the schema below — check the real database.
 *
 * The expectation assertions are the other half. The roster's expected start/end
 * drive `late` and `left_early` incidents, which are disciplinary findings about
 * named drivers, so "no expectation" must never degrade into a default shift. The
 * untracked-staff and uncovered-date tests exist to keep 08:00-17:00 from
 * reappearing as a fallback.
 *
 * SAFETY / ISOLATION: everything lives in a scratch schema reached through the
 * connection string's `options=-c search_path=...`, so the unqualified service
 * SQL resolves there and never touches the shared public schema. Public is not
 * safe to build on: these files share one container and a sibling test drops
 * tables from public partway through the suite.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
      'See .env.local.example.'
  );
}

const SCHEMA = 'mig512_roster_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(
  `-c search_path=${SCHEMA}`
)}`;
// Read by src/lib/db.ts when rosterQueries is imported, which is why that import
// is dynamic and happens in beforeAll.
process.env.DATABASE_URL = SCOPED_URL;

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const SITE = '22222222-2222-4222-8222-222222222222';
const TRACKED = '33333333-3333-3333-3333-333333333333';
const UNTRACKED = '99999999-9999-4999-8999-999999999999';
const VEHICLE = '44444444-4444-4444-4444-444444444444';
const TEAM = '66666666-6666-4666-8666-666666666666';
const USER = '77777777-7777-4777-8777-777777777777';

const WEDNESDAY = '2026-08-19';
const SATURDAY = '2026-08-22';
const SUNDAY = '2026-08-23';
/** Before the policy's active_from — the real coverage gap, see issue #2382. */
const UNCOVERED = '2025-12-31';

/** Live production shapes. Subset of columns; exact names and types. */
const REAL_TABLES = `
  CREATE TABLE projects (
    id UUID PRIMARY KEY, project_name VARCHAR(255) NOT NULL, status VARCHAR(50)
  );
  -- attendance_tracked is the migration-479 opt-in and is NOT NULL DEFAULT false.
  CREATE TABLE staff (
    id UUID PRIMARY KEY, first_name VARCHAR(100) NOT NULL, last_name VARCHAR(100) NOT NULL,
    user_id UUID, home_site_id UUID, status VARCHAR(50), is_active BOOLEAN,
    attendance_tracked BOOLEAN NOT NULL DEFAULT false
  );
  -- teams.name, NOT teams.team_name.
  CREATE TABLE teams (
    id UUID PRIMARY KEY, name VARCHAR(255) NOT NULL,
    is_active BOOLEAN, team_type VARCHAR(50)
  );
  CREATE TABLE team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL, user_id UUID, is_active BOOLEAN
  );
  CREATE TABLE project_team_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL, team_id UUID NOT NULL
  );
  -- fleet_vehicles.registration, NOT registration_number.
  CREATE TABLE fleet_vehicles (
    id UUID PRIMARY KEY, registration VARCHAR(20) NOT NULL, status VARCHAR(20)
  );
  CREATE TABLE vehicle_assignments (
    id UUID PRIMARY KEY, staff_id UUID NOT NULL, fleet_vehicle_id UUID,
    assignment_start DATE NOT NULL, assignment_end DATE
  );
  CREATE TABLE fleet_vehicle_project_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL, project_id UUID NOT NULL,
    assigned_date DATE NOT NULL, returned_date DATE, is_active BOOLEAN NOT NULL DEFAULT true
  );
  CREATE TABLE fleet_project_operational_sites (
    id UUID PRIMARY KEY, project_id UUID NOT NULL, display_name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true, is_default BOOLEAN NOT NULL DEFAULT false
  );
  CREATE TABLE fleet_authorized_locations (
    id UUID PRIMARY KEY, name VARCHAR(255) NOT NULL, is_active BOOLEAN
  );
  CREATE TABLE fleet_operational_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL, project_id UUID NOT NULL, operational_site_id UUID NOT NULL,
    start_date DATE NOT NULL, end_date DATE NOT NULL, assignment_kind TEXT NOT NULL,
    vehicle_assignment_id UUID, status TEXT NOT NULL
  );
  -- The ONE real policy table. findEffectivePolicy rejects any value that is not
  -- the frozen production default, so these defaults are load-bearing.
  CREATE TABLE attendance_schedule_policies (
    id UUID PRIMARY KEY, timezone TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
    active_from DATE NOT NULL, active_to DATE,
    weekday_start TIME NOT NULL DEFAULT '08:00', weekday_end TIME NOT NULL DEFAULT '17:00',
    weekday_unpaid_break_minutes INTEGER NOT NULL DEFAULT 60,
    weekday_paid_cap_hrs NUMERIC(4,2) NOT NULL DEFAULT 8,
    saturday_start TIME NOT NULL DEFAULT '08:00', saturday_end TIME NOT NULL DEFAULT '13:00',
    saturday_paid_cap_hrs NUMERIC(4,2) NOT NULL DEFAULT 5,
    sunday_scheduled BOOLEAN NOT NULL DEFAULT false,
    sunday_missing_out_cap_hrs NUMERIC(4,2) NOT NULL DEFAULT 5,
    late_alert_minutes INTEGER NOT NULL DEFAULT 15
  );
  CREATE TABLE fno_atlas_project_aois (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_code TEXT NOT NULL, area_name TEXT NOT NULL, confidence TEXT NOT NULL,
    retired_at TIMESTAMPTZ
  );
`;

/** Two drivers on one vehicle-derived project: one tracked, one not. */
const SEED = `
  INSERT INTO projects VALUES ('${PROJECT}', 'Roster Test Project', 'active');
  INSERT INTO staff (id, first_name, last_name, user_id, status, is_active, attendance_tracked) VALUES
    ('${TRACKED}', 'Tracked', 'Driver', '${USER}', 'active', true, true),
    ('${UNTRACKED}', 'Untracked', 'Driver', NULL, 'active', true, false);
  INSERT INTO teams VALUES ('${TEAM}', 'Roster Test Team', true, 'internal');
  INSERT INTO team_members (team_id, user_id, is_active) VALUES ('${TEAM}', '${USER}', true);
  INSERT INTO project_team_assignments (project_id, team_id) VALUES ('${PROJECT}', '${TEAM}');
  INSERT INTO fleet_vehicles VALUES ('${VEHICLE}', 'MW63YBGP', 'active');
  INSERT INTO vehicle_assignments (id, staff_id, fleet_vehicle_id, assignment_start, assignment_end)
    VALUES (gen_random_uuid(), '${TRACKED}', '${VEHICLE}', '2026-01-01', NULL);
  INSERT INTO fleet_vehicle_project_assignments (vehicle_id, project_id, assigned_date)
    VALUES ('${VEHICLE}', '${PROJECT}', '2026-01-01');
  INSERT INTO fleet_project_operational_sites VALUES
    ('${SITE}', '${PROJECT}', 'Roster Test Site', true, true);
  INSERT INTO fleet_authorized_locations VALUES
    ('55555555-5555-4555-8555-555555555555', 'Roster Test Depot', true);
  INSERT INTO attendance_schedule_policies (id, active_from)
    VALUES ('88888888-8888-4888-8888-888888888888', '2026-04-24');
  INSERT INTO fno_atlas_project_aois (site_code, area_name, confidence)
    VALUES ('RTS001', 'Roster Test Area', 'high');
`;

/** Creates and drops the schema; must not be scoped to it. */
const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
/** Same view of the database the application pool gets. */
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 2 });

type Queries = typeof import('@/modules/fleet/assignments/rosterQueries');
type Schedule = typeof import('@/modules/fleet/assignments/rosterSchedule');
let queries: Queries;
let schedule: Schedule;

async function rosterFor(staffId: string, workDate: string) {
  const result = await queries.listAssignmentRoster({ staffId, startDate: workDate, endDate: workDate });
  expect(result.items).toHaveLength(1);
  return result.items[0]!;
}

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await db.query(REAL_TABLES);
  await db.query(SEED);
  queries = await import('@/modules/fleet/assignments/rosterQueries');
  schedule = await import('@/modules/fleet/assignments/rosterSchedule');
});

afterAll(async () => {
  const { pool: appPool } = await import('@/lib/db-pool');
  await appPool.end();
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

describe('buildAssignmentRosterQuery against a real database', () => {
  it('executes with every filter applied, including the unassigned-scheduled branch', async () => {
    const days = await schedule.resolveRosterSchedule({ startDate: WEDNESDAY, endDate: WEDNESDAY });
    for (const filters of [
      {},
      { projectId: PROJECT },
      { staffId: TRACKED },
      { siteId: SITE },
      { source: 'roster' as const },
      { projectId: PROJECT, unassignedScheduled: true },
    ]) {
      const { text, params } = queries.buildAssignmentRosterQuery(
        { ...filters, startDate: WEDNESDAY, endDate: WEDNESDAY }, days);
      await expect(db.query(text, params as unknown[])).resolves.toBeDefined();
    }
  });

  it('names no relation that is absent from the real schema', async () => {
    const { text } = queries.buildAssignmentRosterQuery();
    const referenced = new Set(
      [...text.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi)]
        .map((m) => m[1]!.toLowerCase())
        // CTEs and derived tables defined inside the query itself.
        .filter((name) => !['staff_days', 'policy_days', 'effective', 'unnest', 'generate_series', 'lateral'].includes(name))
    );
    expect(referenced.size).toBeGreaterThan(5);

    const { rows } = await db.query<{ name: string; exists: boolean }>(
      `SELECT n AS name, to_regclass($2 || '.' || n) IS NOT NULL AS exists
         FROM unnest($1::text[]) n`,
      [[...referenced], SCHEMA]
    );
    expect(rows.filter((r) => !r.exists).map((r) => r.name)).toEqual([]);
  });

  /**
   * Reads the plate back through the real fleet_vehicles join. This is what
   * distinguishes "the query parses" from "the query returns the driver's
   * registration" — aliasing the wrong source column would still parse.
   */
  it('resolves the assigned vehicle registration from fleet_vehicles.registration', async () => {
    expect(await rosterFor(TRACKED, WEDNESDAY)).toMatchObject({
      staffId: TRACKED,
      staffName: 'Tracked Driver',
      projectId: PROJECT,
      assignmentKind: 'vehicle_project',
      vehicleRegistration: 'MW63YBGP',
    });
  });
});

describe('roster expectation from the attendance schedule policy', () => {
  it('uses the weekday window Monday to Friday', async () => {
    expect(await rosterFor(TRACKED, WEDNESDAY)).toMatchObject({
      scheduled: true, expectedStartTime: '08:00', expectedEndTime: '17:00',
    });
  });

  it('uses the Saturday window on Saturday', async () => {
    expect(await rosterFor(TRACKED, SATURDAY)).toMatchObject({
      scheduled: true, expectedStartTime: '08:00', expectedEndTime: '13:00',
    });
  });

  it('gives Sunday no expectation', async () => {
    expect(await rosterFor(TRACKED, SUNDAY)).toMatchObject({
      scheduled: false, expectedStartTime: null, expectedEndTime: null,
    });
  });

  /**
   * The two tests below are the guard against a default shift creeping back in.
   * Both must yield NULL times — not 08:00-17:00 — because the roster's expected
   * start feeds `late` incidents against a named person.
   */
  it('gives an untracked staff member no expectation on a covered working day', async () => {
    const row = await rosterFor(UNTRACKED, WEDNESDAY);
    expect(row).toMatchObject({
      staffName: 'Untracked Driver',
      scheduled: false, expectedStartTime: null, expectedEndTime: null,
    });
  });

  it('gives a date no policy covers no expectation, for tracked staff too', async () => {
    expect(await rosterFor(TRACKED, UNCOVERED)).toMatchObject({
      scheduled: false, expectedStartTime: null, expectedEndTime: null,
    });
  });
});

describe('listAssignmentOptions against a real database', () => {
  it('labels vehicles by registration and teams by name', async () => {
    const options = await queries.listAssignmentOptions({}, [PROJECT]);

    expect(options.vehicles).toEqual([
      expect.objectContaining({ id: VEHICLE, label: 'MW63YBGP' }),
    ]);
    expect(options.teams).toEqual([
      expect.objectContaining({ id: TEAM, label: 'Roster Test Team' }),
    ]);
    expect(options.projects).toEqual([
      expect.objectContaining({ id: PROJECT, label: 'Roster Test Project' }),
    ]);
    expect(options.sites).toEqual([
      expect.objectContaining({ id: SITE, label: 'Roster Test Site' }),
    ]);
    expect(options.siteSources).toHaveLength(2);
  });

  it('returns empty collections when no project is authorized', async () => {
    await expect(queries.listAssignmentOptions({}, [])).resolves.toMatchObject({
      staff: [], teams: [], projects: [], sites: [], vehicles: [], siteSources: [],
    });
  });
});

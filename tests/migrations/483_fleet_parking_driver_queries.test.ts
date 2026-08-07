/**
 * The driver-side parking SQL, executed against a real Postgres.
 *
 * Same reasoning as 483_fleet_parking_queries.test.ts: the unit tests in
 * src/modules/fleet/parking/__tests__/driverParkingQueries.test.ts mock the
 * `sql` tag out entirely, which is right for testing the mapping but leaves
 * every statement in that module unparsed. A wrong column name or a bad cast
 * would then fail for the first driver who taps the button, not in CI.
 *
 * Three behaviours here are decided by SQL and by the schema, not by
 * TypeScript, and each one has a way of failing silently:
 *
 *   - the assignment join is on a registration *string*, because
 *     vehicle_assignments has no vehicle FK;
 *   - the "one open request" rule is a partial unique index, and the route
 *     turns its 23505 into a 409 by matching the constraint NAME — so the name
 *     is load-bearing, and this file is what pins it;
 *   - the approver lookup reaches into a JSONB column (`actions->>'view'`).
 *
 * SAFETY / ISOLATION: everything lives in a scratch schema, including the
 * prerequisite tables, for the reason given in the sibling file — these run in
 * one shared container and a sibling test drops role_permissions from public
 * partway through the suite.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
      'See .env.local.example.'
  );
}

const SCHEMA = 'mig483_driver_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(
  `-c search_path=${SCHEMA}`
)}`;
// Read by src/lib/db.ts when the module below is imported, which is why that
// import is dynamic and happens in beforeAll.
process.env.DATABASE_URL = SCOPED_URL;

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD = readFileSync(join(SQL_DIR, '483_fleet_parking_compliance.sql'), 'utf8');

const VEHICLE = '44444444-4444-4444-4444-444444444444';
const OTHER_VEHICLE = '55555555-5555-5555-5555-555555555555';
const DRIVER = '33333333-3333-3333-3333-333333333333';
const OTHER_DRIVER = '66666666-6666-6666-6666-666666666666';
const MANAGER_USER = '77777777-7777-7777-7777-777777777777';
const VIEWER_USER = '88888888-8888-8888-8888-888888888888';
const INACTIVE_MANAGER = '99999999-9999-9999-9999-999999999999';

/** Everything 483 and the driver query layer reference. */
const PREREQUISITES = `
  CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY);
  CREATE TABLE staff (id UUID PRIMARY KEY, full_name TEXT NOT NULL);
  CREATE TABLE users (
    id UUID PRIMARY KEY, role VARCHAR(50) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true
  );
  CREATE TABLE access_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(20) NOT NULL, key VARCHAR(100) UNIQUE NOT NULL,
    parent_key VARCHAR(100), label VARCHAR(100) NOT NULL, description TEXT,
    route VARCHAR(200), sort_order INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT TRUE
  );
  CREATE TABLE role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role VARCHAR(50) NOT NULL,
    permission_key VARCHAR(100) NOT NULL REFERENCES access_permissions(key) ON DELETE CASCADE,
    actions JSONB NOT NULL, UNIQUE (role, permission_key)
  );
  CREATE TABLE fleet_vehicles (
    id UUID PRIMARY KEY, registration VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
  );
  CREATE TABLE fleet_vehicle_trackers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT true
  );
  CREATE TABLE fleet_vehicle_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
    recorded_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lat NUMERIC(10,7) NOT NULL, lon NUMERIC(10,7) NOT NULL
  );
  CREATE TABLE vehicle_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES staff(id),
    vehicle_registration VARCHAR(20) NOT NULL,
    assignment_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active BOOLEAN NOT NULL DEFAULT true
  );
  INSERT INTO staff (id, full_name) VALUES
    ('${DRIVER}', 'Test Driver'), ('${OTHER_DRIVER}', 'Other Driver');
  INSERT INTO users (id, role, is_active) VALUES
    ('${MANAGER_USER}', 'manager', true),
    ('${VIEWER_USER}', 'viewer', true),
    ('${INACTIVE_MANAGER}', 'manager', false);
  INSERT INTO fleet_vehicles (id, registration, status) VALUES
    ('${VEHICLE}', 'MW67LFGP', 'active'), ('${OTHER_VEHICLE}', 'MW99OTHGP', 'active');
`;

/** Creates and drops the schema; must not be scoped to it. */
const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
/** Same view of the database the application pool gets. */
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 2 });

type DriverQueries = typeof import('@/modules/fleet/parking/driverParkingQueries');
type Approvers = typeof import('@/modules/fleet/parking/parkingApprovers');
let queries: DriverQueries;
let approvers: Approvers;

async function assign(
  staffId: string,
  registration: string,
  isActive = true,
  start = '2026-01-01T00:00:00Z'
): Promise<void> {
  await db.query(
    `INSERT INTO vehicle_assignments (staff_id, vehicle_registration, is_active, assignment_start)
     VALUES ($1, $2, $3, $4)`,
    [staffId, registration, isActive, start]
  );
}

function declaration(over: Partial<Parameters<DriverQueries['insertPendingDeclaration']>[0]> = {}) {
  return {
    vehicleId: VEHICLE,
    staffId: DRIVER,
    lat: -26.1929,
    lon: 28.0305,
    accuracyM: 11.5,
    label: 'My yard',
    addressText: 'Braamfontein, Johannesburg',
    requestNote: null,
    ...over,
  };
}

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await db.query(PREREQUISITES);
  await db.query(FORWARD);
  queries = await import('@/modules/fleet/parking/driverParkingQueries');
  approvers = await import('@/modules/fleet/parking/parkingApprovers');
});

afterAll(async () => {
  const { pool: appPool } = await import('@/lib/db-pool');
  await appPool.end();
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

beforeEach(async () => {
  await db.query(`DELETE FROM fleet_vehicle_parking_locations`);
  await db.query(`DELETE FROM vehicle_assignments`);
});

describe('resolveDriverVehicle', () => {
  it('returns null when the driver has no assignment', async () => {
    expect(await queries.resolveDriverVehicle(DRIVER)).toBeNull();
  });

  // The join is on a registration string because vehicle_assignments has no
  // vehicle FK. A rename on either side breaks it silently.
  it('joins the assignment to the vehicle through the registration string', async () => {
    await assign(DRIVER, 'MW67LFGP');
    expect(await queries.resolveDriverVehicle(DRIVER)).toEqual({
      vehicleId: VEHICLE,
      registration: 'MW67LFGP',
    });
  });

  it('ignores an ended assignment', async () => {
    await assign(DRIVER, 'MW67LFGP', false);
    expect(await queries.resolveDriverVehicle(DRIVER)).toBeNull();
  });

  it('takes the newest active assignment when a driver has more than one', async () => {
    await assign(DRIVER, 'MW67LFGP', true, '2026-01-01T00:00:00Z');
    await assign(DRIVER, 'MW99OTHGP', true, '2026-06-01T00:00:00Z');
    expect((await queries.resolveDriverVehicle(DRIVER))?.registration).toBe('MW99OTHGP');
  });

  // An assignment naming a registration no vehicle carries must not resolve to
  // some other vehicle — the inner join is what guarantees that.
  it('returns null when the assigned registration matches no vehicle', async () => {
    await assign(DRIVER, 'GHOST123GP');
    expect(await queries.resolveDriverVehicle(DRIVER)).toBeNull();
  });
});

describe('insertPendingDeclaration', () => {
  it('stores a submission as pending and returns it parsed', async () => {
    const row = await queries.insertPendingDeclaration(declaration());

    expect(row.status).toBe('pending');
    expect(row.lat).toBe(-26.1929);
    expect(row.lon).toBe(28.0305);
    expect(row.accuracyM).toBe(11.5);
    // Not declared by the caller — it is the column default, and the nightly
    // check reads it.
    expect(row.radiusM).toBe(200);
    expect(typeof row.createdAt).toBe('string');
  });

  /**
   * The route turns this exact error into a 409, matching on the constraint
   * name. If the index is ever renamed, that mapping silently degrades to a
   * 500 and this is the test that catches it.
   */
  it('rejects a second open request with the named partial unique index', async () => {
    await queries.insertPendingDeclaration(declaration());

    await expect(queries.insertPendingDeclaration(declaration())).rejects.toMatchObject({
      code: '23505',
      constraint: queries.PENDING_CONFLICT,
    });
  });

  it('allows a pending request on a different vehicle', async () => {
    await queries.insertPendingDeclaration(declaration());
    const other = await queries.insertPendingDeclaration(
      declaration({ vehicleId: OTHER_VEHICLE, staffId: OTHER_DRIVER })
    );
    expect(other.status).toBe('pending');
  });

  // The active/pending indexes are independent: a driver with an approved
  // address must still be able to request a change.
  it('allows a pending request alongside an active address', async () => {
    await db.query(
      `INSERT INTO fleet_vehicle_parking_locations
         (vehicle_id, declared_by_staff_id, lat, lon, status, effective_from)
       VALUES ($1, $2, -26.1, 28.0, 'active', now())`,
      [VEHICLE, DRIVER]
    );
    const row = await queries.insertPendingDeclaration(declaration());
    expect(row.status).toBe('pending');
  });

  it('stores a null label and a null address without complaint', async () => {
    const row = await queries.insertPendingDeclaration(
      declaration({ label: null, addressText: null })
    );
    expect(row.label).toBeNull();
    expect(row.addressText).toBeNull();
  });
});

describe('loadDriverParkingState', () => {
  it('returns empty state for a vehicle with no declarations', async () => {
    expect(await queries.loadDriverParkingState(VEHICLE)).toEqual({
      active: null,
      pending: null,
      history: [],
    });
  });

  it('splits active, pending and decided rows', async () => {
    await db.query(
      `INSERT INTO fleet_vehicle_parking_locations
         (vehicle_id, declared_by_staff_id, lat, lon, status, decision_note, decided_at)
       VALUES
         ($1, $2, -26.1, 28.0, 'active', NULL, NULL),
         ($1, $2, -26.2, 28.1, 'rejected', 'Too far from the depot', now()),
         ($1, $2, -26.3, 28.2, 'superseded', NULL, NULL)`,
      [VEHICLE, DRIVER]
    );
    await queries.insertPendingDeclaration(declaration());

    const state = await queries.loadDriverParkingState(VEHICLE);

    expect(state.active?.status).toBe('active');
    expect(state.pending?.status).toBe('pending');
    expect(state.history.map((h) => h.status).sort()).toEqual(['rejected', 'superseded']);
    expect(state.history.find((h) => h.status === 'rejected')?.decisionNote).toBe(
      'Too far from the depot'
    );
  });

  it('does not leak another vehicle rows', async () => {
    await queries.insertPendingDeclaration(declaration({ vehicleId: OTHER_VEHICLE }));
    const state = await queries.loadDriverParkingState(VEHICLE);
    expect(state.pending).toBeNull();
  });
});

describe('withdrawPendingDeclaration', () => {
  it('withdraws the caller own open request', async () => {
    await queries.insertPendingDeclaration(declaration());

    expect(await queries.withdrawPendingDeclaration(VEHICLE, DRIVER)).toBe(true);

    const state = await queries.loadDriverParkingState(VEHICLE);
    expect(state.pending).toBeNull();
    expect(state.history.map((h) => h.status)).toEqual(['withdrawn']);
  });

  it('reports false when nothing is open', async () => {
    expect(await queries.withdrawPendingDeclaration(VEHICLE, DRIVER)).toBe(false);
  });

  // A vehicle can change hands. The previous driver must not be able to
  // withdraw the current driver's request.
  it('will not withdraw a request another driver made', async () => {
    await queries.insertPendingDeclaration(declaration({ staffId: OTHER_DRIVER }));

    expect(await queries.withdrawPendingDeclaration(VEHICLE, DRIVER)).toBe(false);
    expect((await queries.loadDriverParkingState(VEHICLE)).pending).not.toBeNull();
  });

  it('leaves an already-active address alone', async () => {
    await db.query(
      `INSERT INTO fleet_vehicle_parking_locations
         (vehicle_id, declared_by_staff_id, lat, lon, status)
       VALUES ($1, $2, -26.1, 28.0, 'active')`,
      [VEHICLE, DRIVER]
    );

    expect(await queries.withdrawPendingDeclaration(VEHICLE, DRIVER)).toBe(false);
    expect((await queries.loadDriverParkingState(VEHICLE)).active).not.toBeNull();
  });
});

/**
 * Migration 483 seeds these grants itself, so this also checks that the seed
 * and the lookup agree — the failure mode being an approval queue that ships
 * with nobody able to see it.
 */
describe('findApproverUserIds', () => {
  it('returns users whose role holds view on fleet.parking-requests', async () => {
    expect(await approvers.findApproverUserIds()).toContain(MANAGER_USER);
  });

  // 483 grants viewer view:false on the requests page deliberately.
  it('excludes a role granted the page with view false', async () => {
    expect(await approvers.findApproverUserIds()).not.toContain(VIEWER_USER);
  });

  it('excludes a deactivated user', async () => {
    expect(await approvers.findApproverUserIds()).not.toContain(INACTIVE_MANAGER);
  });
});

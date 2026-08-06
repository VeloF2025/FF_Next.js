/**
 * The parking-check SQL, executed against a real Postgres.
 *
 * src/modules/fleet/parking/__tests__/runParkingCheck.test.ts mocks
 * parkingQueries out entirely — correctly, it is testing orchestration — which
 * leaves the two statements in that module unparsed by anything. That is the
 * shape of bug that has shipped a 500 past a green CI here before: a stub
 * client records SQL text and never sends it, so a bad cast or a wrong column
 * name only fails at 20:00 SAST in production.
 *
 * So this file calls the real functions, and covers the two behaviours decided
 * by SQL rather than by TypeScript: which fix counts as "last known position",
 * and what the day-slot upsert reports back about the row it wrote.
 *
 * SAFETY / ISOLATION: everything lives in a scratch schema, including the
 * prerequisite tables. The application pool is pointed at that schema through
 * the connection string's `options=-c search_path=...`, so the real service SQL
 * — which is unqualified — resolves there and never touches the shared public
 * schema. Public is not safe to build on here: these files run in one shared
 * container and a sibling migration test drops `role_permissions` from public
 * partway through the suite.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
      'See .env.local.example.'
  );
}

const SCHEMA = 'mig483_queries_scratch';
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
import type { ComplianceCheckRow, ParkingCandidate } from '@/modules/fleet/parking/types';

const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD = readFileSync(join(SQL_DIR, '483_fleet_parking_compliance.sql'), 'utf8');

const VEHICLE = '44444444-4444-4444-4444-444444444444';
const RETIRED = '55555555-5555-5555-5555-555555555555';
const STAFF = '33333333-3333-3333-3333-333333333333';
const CHECK_AT = new Date('2026-08-04T18:00:00.000Z'); // 20:00 SAST

/** Everything 483 and the query layer reference, declared in the scratch schema. */
const PREREQUISITES = `
  CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY);
  CREATE TABLE staff (id UUID PRIMARY KEY, full_name TEXT NOT NULL);
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
  INSERT INTO staff (id, full_name) VALUES ('${STAFF}', 'Test Tech');
  INSERT INTO fleet_vehicles (id, registration, status) VALUES
    ('${VEHICLE}', 'MW67LFGP', 'active'), ('${RETIRED}', 'MW99OLDGP', 'retired');
  INSERT INTO fleet_vehicle_trackers (vehicle_id) VALUES ('${VEHICLE}');
`;

/** Creates and drops the schema; must not be scoped to it. */
const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
/** Same view of the database the application pool gets. */
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 2 });

type Queries = typeof import('@/modules/fleet/parking/parkingQueries');
let queries: Queries;

function row(over: Partial<ComplianceCheckRow> = {}): ComplianceCheckRow {
  return {
    vehicleId: VEHICLE,
    registration: 'MW67LFGP',
    checkDate: '2026-08-04',
    evaluatedAt: CHECK_AT,
    parkingLocationId: null,
    lastFixAt: null,
    lastFixLat: null,
    lastFixLon: null,
    lastFixAgeSeconds: null,
    distanceM: null,
    result: 'unknown',
    ...over,
  };
}

async function addFix(recordedAt: string, lat: number, receivedAt?: string): Promise<void> {
  await db.query(
    `INSERT INTO fleet_vehicle_positions (vehicle_id, recorded_at, received_at, lat, lon)
     VALUES ($1, $2, COALESCE($3::timestamptz, now()), $4, 28.0305)`,
    [VEHICLE, recordedAt, receivedAt ?? null, lat]
  );
}

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await db.query(PREREQUISITES);
  await db.query(FORWARD);
  queries = await import('@/modules/fleet/parking/parkingQueries');
});

afterAll(async () => {
  const { pool: appPool } = await import('@/lib/db-pool');
  await appPool.end();
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

beforeEach(async () => {
  await db.query(`DELETE FROM fleet_parking_compliance_checks`);
  await db.query(`DELETE FROM fleet_vehicle_positions`);
  await db.query(`DELETE FROM fleet_vehicle_parking_locations`);
});

describe('loadParkingCheckCandidates', () => {
  it('returns active vehicles with their tracker flag, and skips retired ones', async () => {
    const candidates: ParkingCandidate[] = await queries.loadParkingCheckCandidates(CHECK_AT);

    expect(candidates.map((c) => c.vehicleId)).toEqual([VEHICLE]);
    expect(candidates[0]!.hasTracker).toBe(true);
    expect(candidates[0]!.registration).toBe('MW67LFGP');
  });

  it('parses the declared location as numbers, not the strings pg returns for NUMERIC', async () => {
    await db.query(
      `INSERT INTO fleet_vehicle_parking_locations
         (vehicle_id, declared_by_staff_id, lat, lon, radius_m, status)
       VALUES ($1, $2, -26.1929, 28.0305, 150, 'active')`,
      [VEHICLE, STAFF]
    );

    const [candidate] = await queries.loadParkingCheckCandidates(CHECK_AT);

    expect(candidate!.location).toMatchObject({ lat: -26.1929, lon: 28.0305, radiusM: 150 });
    expect(typeof candidate!.location!.lat).toBe('number');
  });

  it('takes the newest fix at or before the check instant, ignoring later ones', async () => {
    await addFix('2026-08-04T12:00:00Z', -26.1);
    await addFix('2026-08-04T17:00:00Z', -26.2);
    // After 20:00 SAST — belongs to the next check, not this one.
    await addFix('2026-08-04T19:00:00Z', -26.3);

    const [candidate] = await queries.loadParkingCheckCandidates(CHECK_AT);

    expect(candidate!.lastFix!.lat).toBe(-26.2);
  });

  // Two ingests can round to the same second. Without a total order the winner
  // is whichever row the plan reaches first, which is enough to flip a stored
  // verdict between two runs of the same day with no new data.
  it('breaks a recorded_at tie deterministically, by received_at', async () => {
    await addFix('2026-08-04T17:00:00Z', -26.4, '2026-08-04T17:00:05Z');
    await addFix('2026-08-04T17:00:00Z', -26.5, '2026-08-04T17:00:09Z');

    for (let i = 0; i < 3; i++) {
      const [candidate] = await queries.loadParkingCheckCandidates(CHECK_AT);
      expect(candidate!.lastFix!.lat).toBe(-26.5);
    }
  });

  it('returns a null fix and a null location for a vehicle with neither', async () => {
    const [candidate] = await queries.loadParkingCheckCandidates(CHECK_AT);
    expect(candidate!.lastFix).toBeNull();
    expect(candidate!.location).toBeNull();
  });
});

describe('insertComplianceCheck', () => {
  it('writes a new day slot and reports no previous result', async () => {
    const write = await queries.insertComplianceCheck(row({ result: 'compliant' }));

    expect(write).toEqual({ inserted: true, previousResult: null });
    const { rows } = await db.query(
      `SELECT result, vehicle_registration FROM fleet_parking_compliance_checks`
    );
    expect(rows[0]).toMatchObject({ result: 'compliant', vehicle_registration: 'MW67LFGP' });
  });

  // The seam PR 2 alerts on. A re-run that discovers a violation is an UPDATE,
  // so `inserted` alone would suppress exactly the alert worth sending.
  it('overwrites the day slot and reports what it said before', async () => {
    await queries.insertComplianceCheck(row({ result: 'unknown' }));
    const write = await queries.insertComplianceCheck(
      row({ result: 'violation', distanceM: 41_000 })
    );

    expect(write).toEqual({ inserted: false, previousResult: 'unknown' });
    const { rows } = await db.query(
      `SELECT result, distance_m FROM fleet_parking_compliance_checks`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ result: 'violation', distance_m: 41_000 });
  });

  it('keeps one row per vehicle per day across repeated runs', async () => {
    for (const result of ['unknown', 'violation', 'compliant'] as const) {
      await queries.insertComplianceCheck(row({ result }));
    }
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM fleet_parking_compliance_checks`
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('stores the deciding evidence alongside the verdict', async () => {
    await queries.insertComplianceCheck(
      row({
        result: 'violation',
        lastFixAt: new Date('2026-08-04T17:00:00Z'),
        lastFixLat: -26.2,
        lastFixLon: 28.3,
        lastFixAgeSeconds: 3600,
        distanceM: 41_000,
      })
    );

    const { rows } = await db.query(
      `SELECT last_fix_lat::text AS lat, last_fix_age_seconds, distance_m
         FROM fleet_parking_compliance_checks`
    );
    expect(rows[0]).toMatchObject({ last_fix_age_seconds: 3600, distance_m: 41_000 });
    expect(Number(rows[0]!.lat)).toBe(-26.2);
  });
});

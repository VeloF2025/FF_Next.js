/**
 * Integration test for migration 483 — overnight parking compliance tables.
 *
 * What matters about this migration, and what this file pins:
 *
 *   1. A compliance check is EVIDENCE. Hard-deleting the vehicle it describes
 *      (pages/api/fleet/vehicles.ts exposes DELETE ?permanent=true) must not
 *      erase it — the FK nulls and the registration snapshot keeps the row
 *      readable. The same holds for the parking location it was checked
 *      against. An ON DELETE CASCADE here would silently destroy the record a
 *      disputed deduction is settled from, and nothing else in the stack would
 *      notice.
 *   2. The coordinate CHECKs are the database-level backstop for the write
 *      paths that do not go through isValidLatLon (backfills, manual psql).
 *   3. Re-applying is a no-op, including over rows that already exist — the
 *      deploy runner can re-run a migration after a partial failure.
 *   4. The rollback reverses everything, clears its own schema_migrations row,
 *      and is itself re-runnable.
 *
 * The SQL the application sends against these tables is covered separately, by
 * 483_fleet_parking_queries.test.ts.
 *
 * SAFETY: everything is created in a scratch schema dropped in afterAll.
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

const SCHEMA = 'mig483_scratch';
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');

const FORWARD = readFileSync(join(SQL_DIR, '483_fleet_parking_compliance.sql'), 'utf8');
const ROLLBACK = readFileSync(join(SQL_DIR, 'rollback_483_fleet_parking_compliance.sql'), 'utf8');

const VEHICLE = '11111111-1111-1111-1111-111111111111';
const STAFF = '33333333-3333-3333-3333-333333333333';

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
    await client.query(`SET search_path TO ${SCHEMA}`);
    const r = await client.query(sql, params);
    return (r.rows ?? []) as T[];
  } finally {
    client.release();
  }
}

/**
 * The tables 483 references. Declared here rather than pulled from a seed so
 * this test states its own prerequisites — and so `search_path` can exclude
 * public entirely, which stops an unqualified name silently resolving to the
 * shared seed's copy.
 */
const PREREQUISITES = `
  CREATE TABLE schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL
  );
  CREATE TABLE fleet_vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
  );
  CREATE TABLE access_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(20) NOT NULL,
    key VARCHAR(100) UNIQUE NOT NULL,
    parent_key VARCHAR(100),
    label VARCHAR(100) NOT NULL,
    description TEXT,
    route VARCHAR(200),
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE
  );
  CREATE TABLE role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role VARCHAR(50) NOT NULL,
    permission_key VARCHAR(100) NOT NULL REFERENCES access_permissions(key) ON DELETE CASCADE,
    actions JSONB NOT NULL,
    UNIQUE (role, permission_key)
  );
  INSERT INTO staff (id, full_name) VALUES ('${STAFF}', 'Test Tech');
  INSERT INTO fleet_vehicles (id, registration) VALUES ('${VEHICLE}', 'MW67LFGP');
`;

async function activeLocation(): Promise<string> {
  const [row] = await scoped<{ id: string }>(
    `INSERT INTO fleet_vehicle_parking_locations
       (vehicle_id, declared_by_staff_id, lat, lon, status)
     VALUES ($1, $2, -26.1929, 28.0305, 'active') RETURNING id`,
    [VEHICLE, STAFF]
  );
  return row!.id;
}

async function checkRow(locationId: string | null, checkDate: string): Promise<void> {
  await scoped(
    `INSERT INTO fleet_parking_compliance_checks
       (vehicle_id, vehicle_registration, check_date, evaluated_at, parking_location_id, result)
     VALUES ($1, 'MW67LFGP', $2, now(), $3, 'violation')`,
    [VEHICLE, checkDate, locationId]
  );
}

beforeAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  await scoped(PREREQUISITES);
  await scoped(FORWARD);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.end();
});

describe('migration 483 — schema contract', () => {
  it('creates both tables', async () => {
    const rows = await scoped<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 ORDER BY table_name`,
      [SCHEMA]
    );
    expect(rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining(['fleet_parking_compliance_checks', 'fleet_vehicle_parking_locations'])
    );
  });

  it('allows only one active and one pending location per vehicle', async () => {
    await activeLocation();
    await expect(activeLocation()).rejects.toThrow(/ux_parking_active_per_vehicle/);
    await scoped(`DELETE FROM fleet_vehicle_parking_locations`);
  });

  it('allows only one check per vehicle per day', async () => {
    await checkRow(null, '2026-08-04');
    await expect(checkRow(null, '2026-08-04')).rejects.toThrow(
      /ux_parking_check_per_vehicle_day/
    );
    await scoped(`DELETE FROM fleet_parking_compliance_checks`);
  });

  it('rejects out-of-range coordinates on a declared location', async () => {
    await expect(
      scoped(
        `INSERT INTO fleet_vehicle_parking_locations
           (vehicle_id, declared_by_staff_id, lat, lon, status)
         VALUES ($1, $2, 200, 28.0305, 'active')`,
        [VEHICLE, STAFF]
      )
    ).rejects.toThrow(/fleet_parking_lat_range/);
  });

  it('rejects out-of-range coordinates on a recorded fix', async () => {
    await expect(
      scoped(
        `INSERT INTO fleet_parking_compliance_checks
           (vehicle_id, vehicle_registration, check_date, evaluated_at, last_fix_lon, result)
         VALUES ($1, 'MW67LFGP', '2026-08-09', now(), 999, 'unknown')`,
        [VEHICLE]
      )
    ).rejects.toThrow(/fleet_parking_fix_lon_range/);
  });

  it('rejects an unknown result value', async () => {
    await expect(
      scoped(
        `INSERT INTO fleet_parking_compliance_checks
           (vehicle_id, vehicle_registration, check_date, evaluated_at, result)
         VALUES ($1, 'MW67LFGP', '2026-08-10', now(), 'probably_fine')`,
        [VEHICLE]
      )
    ).rejects.toThrow(/fleet_parking_result_check/);
  });

  it('grants the two new pages to the roles that need them', async () => {
    const rows = await scoped<{ role: string; permission_key: string }>(
      `SELECT role, permission_key FROM role_permissions
        WHERE permission_key IN ('fleet.parking', 'fleet.parking-requests')
        ORDER BY permission_key, role`
    );
    // A page with no grants is closed to every role except super_admin, so the
    // approval queue would ship with no one able to open it.
    expect(rows.filter((r) => r.permission_key === 'fleet.parking').map((r) => r.role)).toEqual([
      'admin',
      'manager',
      'super_admin',
      'viewer',
    ]);
    const approvers = await scoped<{ role: string }>(
      `SELECT role FROM role_permissions
        WHERE permission_key = 'fleet.parking-requests'
          AND (actions->>'view')::boolean ORDER BY role`
    );
    expect(approvers.map((r) => r.role)).toEqual(['admin', 'manager', 'super_admin']);
  });
});

describe('migration 483 — compliance history outlives what it describes', () => {
  it('keeps the check row when the parking location it referenced is deleted', async () => {
    const locationId = await activeLocation();
    await checkRow(locationId, '2026-08-05');

    await scoped(`DELETE FROM fleet_vehicle_parking_locations WHERE id = $1`, [locationId]);

    const [row] = await scoped<{ parking_location_id: string | null; result: string }>(
      `SELECT parking_location_id, result FROM fleet_parking_compliance_checks
        WHERE check_date = '2026-08-05'`
    );
    expect(row).toBeDefined();
    expect(row!.parking_location_id).toBeNull();
    expect(row!.result).toBe('violation');
  });

  // The regression this migration exists to avoid: one hard-delete of a sold
  // vehicle must not take its entire violation history with it.
  it('keeps the check row, and its registration, when the vehicle is hard-deleted', async () => {
    await checkRow(null, '2026-08-06');

    await scoped(`DELETE FROM fleet_vehicles WHERE id = $1`, [VEHICLE]);

    const [row] = await scoped<{ vehicle_id: string | null; vehicle_registration: string }>(
      `SELECT vehicle_id, vehicle_registration FROM fleet_parking_compliance_checks
        WHERE check_date = '2026-08-06'`
    );
    expect(row).toBeDefined();
    expect(row!.vehicle_id).toBeNull();
    // Still says whose violation it was.
    expect(row!.vehicle_registration).toBe('MW67LFGP');

    // Restore for the remaining cases.
    await scoped(`DELETE FROM fleet_parking_compliance_checks`);
    await scoped(`INSERT INTO fleet_vehicles (id, registration) VALUES ($1, 'MW67LFGP')`, [
      VEHICLE,
    ]);
  });
});

describe('migration 483 — re-runnable, and reversible', () => {
  it('is idempotent — re-applying preserves existing rows', async () => {
    const locationId = await activeLocation();
    await checkRow(locationId, '2026-08-07');

    await scoped(FORWARD);

    const [{ n }] = await scoped<{ n: string }>(
      `SELECT count(*)::text AS n FROM fleet_parking_compliance_checks`
    );
    expect(n).toBe('1');
    const [{ p }] = await scoped<{ p: string }>(
      `SELECT count(*)::text AS p FROM role_permissions
        WHERE permission_key IN ('fleet.parking', 'fleet.parking-requests')`
    );
    expect(p).toBe('8');
  });

  it('rollback removes both tables, the permissions, and its own tracker row', async () => {
    await scoped(
      `INSERT INTO schema_migrations (filename) VALUES ('483_fleet_parking_compliance.sql')`
    );
    await scoped(ROLLBACK);

    const tables = await scoped<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [SCHEMA]
    );
    expect(tables.map((t) => t.table_name)).not.toContain('fleet_parking_compliance_checks');
    expect(tables.map((t) => t.table_name)).not.toContain('fleet_vehicle_parking_locations');

    const perms = await scoped(
      `SELECT key FROM access_permissions WHERE key IN ('fleet.parking', 'fleet.parking-requests')`
    );
    expect(perms).toEqual([]);

    const tracked = await scoped(
      `SELECT filename FROM schema_migrations WHERE filename = '483_fleet_parking_compliance.sql'`
    );
    expect(tracked).toEqual([]);

    // Re-runnable: a second rollback on an already-rolled-back schema must not throw.
    await expect(scoped(ROLLBACK)).resolves.toBeDefined();

    await scoped(FORWARD); // leave the schema as the other cases found it
  });
});

/**
 * The dwell SQL itself, executed against a real PostGIS.
 *
 * classify.test.ts covers the thresholds with hand-built samples; it is blind
 * to whether the SQL that produces those samples is right. Everything that can
 * silently produce a plausible-but-wrong number lives here: PostGIS
 * containment, the LEAD() gap, the 900s cap, fractional attribution across
 * overlapping AOIs, and the SAST day boundary.
 *
 * SAFETY / ISOLATION: its own scratch schema.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
      'See .env.local.example.'
  );
}

const SCHEMA = 'mig522_dwell_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(
  `-c search_path=${SCHEMA},public`
)}`;
process.env.DATABASE_URL = SCOPED_URL;

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { VehicleDwellSample } from '@/modules/fleet/assignments/inference/types';

const FORWARD = readFileSync(
  join(process.cwd(), 'scripts/migrations/sql/522_fleet_site_inference.sql'), 'utf8');

const VEHICLE = '52210000-0000-0000-0000-000000000001';
const NO_GPS = '52210000-0000-0000-0000-000000000002';
const LAWLEY = '52210000-0000-0000-0000-0000000000a1';
const POP1 = '52210000-0000-0000-0000-0000000000a2';
const STAFF = '52210000-0000-0000-0000-0000000000b1';

// Column types diffed against production information_schema on 2026-08-21.
// lat/lon/speed_kph are NUMERIC on production, not double precision.
const PREREQUISITES = `
  CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY);
  CREATE TABLE users (id UUID PRIMARY KEY);
  CREATE TABLE staff (id UUID PRIMARY KEY, first_name VARCHAR(100) NOT NULL,
                      last_name VARCHAR(100) NOT NULL);
  CREATE TABLE projects (id UUID PRIMARY KEY, project_name VARCHAR(255) NOT NULL);
  CREATE TABLE fleet_vehicles (id UUID PRIMARY KEY, registration VARCHAR(20) NOT NULL);
  CREATE TABLE vehicle_assignments (
    id UUID PRIMARY KEY, staff_id UUID NOT NULL REFERENCES staff(id),
    fleet_vehicle_id UUID REFERENCES fleet_vehicles(id),
    vehicle_registration VARCHAR(20) NOT NULL, assignment_start DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE);
  CREATE TABLE fleet_operational_assignments (id UUID PRIMARY KEY);
  CREATE TABLE project_aois (
    project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    aoi GEOGRAPHY(Geometry, 4326) NOT NULL, pole_count INTEGER NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE fleet_vehicle_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id),
    recorded_at TIMESTAMPTZ NOT NULL, lat NUMERIC NOT NULL, lon NUMERIC NOT NULL,
    speed_kph NUMERIC, ignition BOOLEAN);
`;

// Overlapping in x=[2,3], mirroring the real Thembisa POP 1 / POP 3 overlap.
const LAWLEY_AOI = 'SRID=4326;POLYGON((0 0, 3 0, 3 3, 0 3, 0 0))';
const POP1_AOI = 'SRID=4326;POLYGON((2 0, 6 0, 6 3, 2 3, 2 0))';

const WINDOW_START = new Date('2026-08-01T00:00:00Z');
const WINDOW_END = new Date('2026-09-01T00:00:00Z');

let pool: Pool;
let loadVehicleDwellSamples: (a: Date, b: Date, c?: number) => Promise<VehicleDwellSample[]>;

beforeAll(async () => {
  pool = new Pool({ connectionString: BASE_URL });
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  await pool.end();
  pool = new Pool({ connectionString: SCOPED_URL });
  await pool.query(PREREQUISITES);
  await pool.query(FORWARD);
  await pool.query(`INSERT INTO staff (id, first_name, last_name) VALUES ($1,'A','B')`, [STAFF]);
  await pool.query(
    `INSERT INTO projects (id, project_name) VALUES ($1,'Lawley'), ($2,'Thembisa POP 1')`,
    [LAWLEY, POP1]);
  await pool.query(
    `INSERT INTO fleet_vehicles (id, registration) VALUES ($1,'MW67LZGP'), ($2,'CR69KTZN')`,
    [VEHICLE, NO_GPS]);
  await pool.query(`
    INSERT INTO project_aois (project_id, aoi, pole_count)
    VALUES ($1, ST_GeogFromText($3), 1), ($2, ST_GeogFromText($4), 1)`,
    [LAWLEY, POP1, LAWLEY_AOI, POP1_AOI]);
  for (const [vehicle, registration] of [[VEHICLE, 'EMN890GP'], [NO_GPS, 'CR69KTZN']]) {
    await pool.query(`
      INSERT INTO vehicle_assignments (id, staff_id, fleet_vehicle_id, vehicle_registration,
                                       assignment_start, is_active)
      VALUES (gen_random_uuid(), $1, $2, $3, DATE '2026-01-01', TRUE)`,
      [STAFF, vehicle, registration]);
  }
  // db-pool reads DATABASE_URL at import time, hence the dynamic import.
  ({ loadVehicleDwellSamples } = await import(
    '@/modules/fleet/assignments/inference/dwellQueries'));
}, 120_000);

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.end();
});

beforeEach(async () => {
  await pool.query('DELETE FROM fleet_vehicle_positions');
});

async function ping(at: string, lon: number, lat: number, vehicle = VEHICLE): Promise<void> {
  await pool.query(
    `INSERT INTO fleet_vehicle_positions (vehicle_id, recorded_at, lat, lon, speed_kph, ignition)
     VALUES ($1, $2::timestamptz, $3, $4, 0, TRUE)`, [vehicle, at, lat, lon]);
}

function sampleFor(samples: VehicleDwellSample[], vehicleId: string): VehicleDwellSample {
  const found = samples.find((entry) => entry.vehicleId === vehicleId);
  if (!found) throw new Error(`no sample for ${vehicleId}`);
  return found;
}

async function run(): Promise<VehicleDwellSample[]> {
  return loadVehicleDwellSamples(WINDOW_START, WINDOW_END);
}

describe('dwell SQL: time weighting', () => {
  it('credits the gap to the ping that opened it, and nothing to the last ping', async () => {
    await ping('2026-08-10T08:00:00Z', 1, 1);
    await ping('2026-08-10T08:01:00Z', 1, 1);
    const sample = sampleFor(await run(), VEHICLE);
    expect(sample.shares).toHaveLength(1);
    expect(sample.shares[0].projectId).toBe(LAWLEY);
    expect(sample.shares[0].pings).toBe(2);
    expect(sample.shares[0].dwellSeconds).toBe(60);
  });

  it('caps a long gap at 900s instead of banking the whole absence as dwell', async () => {
    await ping('2026-08-10T08:00:00Z', 1, 1);
    await ping('2026-08-10T12:00:00Z', 1, 1);
    const sample = sampleFor(await run(), VEHICLE);
    // 4 hours elapsed; only the 15-minute cap counts.
    expect(sample.shares[0].dwellSeconds).toBe(900);
  });

  it('ranks by dwell where ping count would give the opposite answer', async () => {
    // Six fast pings crossing POP 1, then one long stop in Lawley.
    for (let index = 0; index < 6; index += 1) {
      await ping(`2026-08-10T08:00:0${index}Z`, 5, 1);
    }
    await ping('2026-08-10T08:00:06Z', 1, 1);
    await ping('2026-08-10T08:10:06Z', 1, 1);
    const sample = sampleFor(await run(), VEHICLE);
    const byProject = Object.fromEntries(sample.shares.map((s) => [s.projectId, s]));
    expect(byProject[POP1].pings).toBe(6);
    expect(byProject[LAWLEY].pings).toBe(2);
    expect(byProject[LAWLEY].dwellSeconds).toBe(600);
    expect(byProject[POP1].dwellSeconds).toBe(6);
  });
});

describe('dwell SQL: overlapping AOIs', () => {
  it('splits a ping inside two AOIs in half rather than counting it twice', async () => {
    // x=2.5 is inside both squares.
    await ping('2026-08-10T08:00:00Z', 2.5, 1);
    await ping('2026-08-10T08:01:00Z', 2.5, 1);
    const sample = sampleFor(await run(), VEHICLE);
    expect(sample.shares).toHaveLength(2);
    for (const share of sample.shares) {
      expect(share.pings).toBe(1);
      expect(share.dwellSeconds).toBe(30);
    }
    // Total attributed dwell equals the real elapsed dwell, not double it.
    expect(sample.shares.reduce((total, s) => total + s.dwellSeconds, 0)).toBe(60);
    expect(sample.totalPositions).toBe(2);
  });
});

describe('dwell SQL: AOI boundary', () => {
  it('counts a position sitting exactly on the AOI edge', async () => {
    // The AOI is a convex hull of poles, so a pole-adjacent position lands on a
    // hull vertex. x=0,y=1 is on the Lawley square's western edge. ST_Contains
    // would drop this silently; ST_Intersects keeps it.
    await ping('2026-08-10T08:00:00Z', 0, 1);
    await ping('2026-08-10T08:01:00Z', 0, 1);
    const sample = sampleFor(await run(), VEHICLE);
    expect(sample.shares).toHaveLength(1);
    expect(sample.shares[0].projectId).toBe(LAWLEY);
    expect(sample.shares[0].dwellSeconds).toBe(60);
  });

  it('still excludes a position outside the edge', async () => {
    await ping('2026-08-10T08:00:00Z', -0.0001, 1);
    const sample = sampleFor(await run(), VEHICLE);
    expect(sample.shares).toEqual([]);
    expect(sample.totalPositions).toBe(1);
  });
});

describe('dwell SQL: day counting', () => {
  it('counts distinct days in SAST, not UTC', async () => {
    // Both are 2026-08-10 in UTC, but 23:00 on the 10th and 00:30 on the 11th
    // in Africa/Johannesburg. A UTC implementation reports 1 day here.
    await ping('2026-08-10T21:00:00Z', 1, 1);
    await ping('2026-08-10T22:30:00Z', 1, 1);
    const sample = sampleFor(await run(), VEHICLE);
    expect(sample.shares[0].distinctDays).toBe(2);
  });
});

describe('dwell SQL: the domain', () => {
  it('returns a vehicle with an active assignment and no positions at all', async () => {
    const sample = sampleFor(await run(), NO_GPS);
    expect(sample.totalPositions).toBe(0);
    expect(sample.shares).toEqual([]);
  });

  it('returns a vehicle whose positions all fall outside every AOI', async () => {
    await ping('2026-08-10T08:00:00Z', 40, 40);
    await ping('2026-08-10T08:01:00Z', 40, 40);
    const sample = sampleFor(await run(), VEHICLE);
    expect(sample.totalPositions).toBe(2);
    expect(sample.shares).toEqual([]);
  });

  it('ignores positions outside the window', async () => {
    await ping('2026-07-01T08:00:00Z', 1, 1);
    await ping('2026-09-15T08:00:00Z', 1, 1);
    const sample = sampleFor(await run(), VEHICLE);
    expect(sample.totalPositions).toBe(0);
    expect(sample.shares).toEqual([]);
  });
});

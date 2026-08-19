if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const SCHEMA = 'mig501_attendance_clock_out_aoi_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
// PostGIS lives in public; the migration's objects must land in the scratch
// schema. Both need to be on the path, scratch first.
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA},public`)}`;
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
// 499 supplies project_aois and refresh_project_aois(); 501 only adds the
// clock-out columns, so the pair is applied in order exactly as production did.
const FORWARD_499 = readFileSync(join(SQL_DIR, '499_attendance_project_aois.sql'), 'utf8');
const FORWARD = readFileSync(join(SQL_DIR, '501_attendance_clock_out_aoi.sql'), 'utf8');
const ROLLBACK = readFileSync(join(SQL_DIR, 'rollback_501_attendance_clock_out_aoi.sql'), 'utf8');

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 1 });

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const STAFF = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

// Alpha's poles ring this centre, so a fix here is inside its hull.
const ALPHA_LAT = -26.38;
const ALPHA_LON = 27.81;

// Only the columns closeOpenEntry writes or returns. Deliberately not the full
// production table: anything it does not touch cannot affect the result, and
// listing it would only invite drift.
const PREREQUISITES = `
  CREATE TABLE projects (id UUID PRIMARY KEY, project_name TEXT NOT NULL);
  CREATE TABLE poles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID,
    latitude NUMERIC,
    longitude NUMERIC
  );
  CREATE TABLE staff (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), first_name TEXT);
  CREATE TABLE attendance_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL,
    work_date DATE NOT NULL,
    clock_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    clock_out_at TIMESTAMPTZ,
    client_occurred_at_out TIMESTAMPTZ,
    received_at_out TIMESTAMPTZ,
    clock_in_lat NUMERIC(10,7),
    clock_in_lon NUMERIC(10,7),
    clock_in_accuracy_m NUMERIC(8,2),
    clock_out_lat NUMERIC(10,7),
    clock_out_lon NUMERIC(10,7),
    clock_out_accuracy_m NUMERIC(8,2),
    selfie_in_url TEXT,
    selfie_out_url TEXT,
    vehicle_assignment_id UUID,
    site_geofence_id UUID,
    status TEXT NOT NULL DEFAULT 'open',
    notes TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

/** A ring of n poles around a centre, comfortably inside SA. */
function ring(projectId: string, lat: number, lon: number, n: number): string {
  const rows = Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return `('${projectId}', ${(lat + 0.01 * Math.cos(a)).toFixed(7)}, ${(lon + 0.01 * Math.sin(a)).toFixed(7)})`;
  });
  return `INSERT INTO poles (project_id, latitude, longitude) VALUES ${rows.join(',')};`;
}

// The REAL closeOpenEntry, not a copy of its SQL. @/lib/db builds its pool
// from DATABASE_URL at import time, so the env is pointed at the scratch
// schema before the dynamic import and the production statement is what runs.
// A hand-copied statement here would pass forever after the source changed.
type CloseOpenEntry = typeof import('@/modules/attendance/portal/clockUtils')['closeOpenEntry'];
let closeOpenEntry: CloseOpenEntry;

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.query('CREATE EXTENSION IF NOT EXISTS postgis');
  process.env.DATABASE_URL = SCOPED_URL;
  ({ closeOpenEntry } = await import('@/modules/attendance/portal/clockUtils'));
});

afterAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.end();
  await admin.end();
});

beforeEach(async () => {
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
  await db.query(PREREQUISITES);
  await db.query(`INSERT INTO projects (id, project_name) VALUES ('${P1}','Alpha'), ('${P2}','Beta')`);
  await db.query(ring(P1, ALPHA_LAT, ALPHA_LON, 8));
  await db.query(ring(P2, -25.70, 28.41, 8));
  await db.query(`INSERT INTO staff (id, first_name) VALUES ('${STAFF}', 'Test')`);
  await db.query(FORWARD_499);
  await db.query(FORWARD);
});

async function openEntry(): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO attendance_entries (staff_id, work_date, clock_in_lat, clock_in_lon)
     VALUES ($1, CURRENT_DATE, $2, $3) RETURNING id::text`,
    [STAFF, ALPHA_LAT, ALPHA_LON],
  );
  return r.rows[0].id;
}

function closeArgs(entryId: string, lat: number, lon: number) {
  return {
    entryId,
    staffId: STAFF,
    clockOutAt: new Date(),
    clientOccurredAt: new Date(),
    lat,
    lon,
    accuracyM: 12,
    selfieOutUrl: 'https://example.invalid/out.jpg',
  };
}

describe('migration 501 — clock-out AOI recording', () => {
  it('adds both columns, nullable', async () => {
    const cols = await db.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'attendance_entries'
          AND column_name LIKE 'clock_out_aoi%' ORDER BY column_name`, [SCHEMA]);
    expect(cols.rows.map((r) => r.column_name))
      .toEqual(['clock_out_aoi_distance_m', 'clock_out_aoi_project_id']);
    // Nullable on purpose: the auto-close cron closes entries with no device
    // fix at all, and those must record no project rather than a wrong one.
    expect(cols.rows.every((r) => r.is_nullable === 'YES')).toBe(true);
  });

  it('records project and 0 m when the clock-out fix is inside a site', async () => {
    const id = await openEntry();
    const row = await closeOpenEntry(closeArgs(id, ALPHA_LAT, ALPHA_LON));
    expect(row).not.toBeNull();
    const stored = await db.query(
      `SELECT p.project_name, e.clock_out_aoi_distance_m
         FROM attendance_entries e JOIN projects p ON p.id = e.clock_out_aoi_project_id
        WHERE e.id = $1`, [id]);
    expect(stored.rows[0].project_name).toBe('Alpha');
    expect(Number(stored.rows[0].clock_out_aoi_distance_m)).toBe(0);
    // Pins WHY it is 0: the fix really is the Alpha centre, not a NULL
    // coordinate collapsing the distance to zero.
    expect(Number(row?.clock_out_lat)).toBeCloseTo(ALPHA_LAT, 5);
  });

  it('records the nearest site and a real distance when the fix is off site', async () => {
    const id = await openEntry();
    // ~30 km west of Alpha, still much closer to Alpha than to Beta.
    await closeOpenEntry(closeArgs(id, ALPHA_LAT, ALPHA_LON - 0.3));
    const stored = await db.query(
      `SELECT p.project_name, e.clock_out_aoi_distance_m
         FROM attendance_entries e JOIN projects p ON p.id = e.clock_out_aoi_project_id
        WHERE e.id = $1`, [id]);
    expect(stored.rows[0].project_name).toBe('Alpha');
    expect(Number(stored.rows[0].clock_out_aoi_distance_m)).toBeGreaterThan(10_000);
  });

  it('still closes the entry when no AOI exists at all', async () => {
    // The load-bearing property of the LEFT JOIN LATERAL. With a plain JOIN
    // the UPDATE would match no row, closeOpenEntry would return null, and
    // the handler would 409 the staff member — an empty project_aois table
    // (a failed refresh cron) would block every clock-out on site.
    await db.query('TRUNCATE project_aois');
    const id = await openEntry();
    const row = await closeOpenEntry(closeArgs(id, ALPHA_LAT, ALPHA_LON));
    expect(row).not.toBeNull();
    expect(row?.status).toBe('closed');
    expect(row?.clock_out_aoi_project_id ?? null).toBeNull();
    expect(row?.clock_out_aoi_distance_m ?? null).toBeNull();
  });

  it('does not close an entry belonging to another staff member', async () => {
    // The AOI join must not have widened the UPDATE's match: the staff_id and
    // status guards still decide which row is written.
    const id = await openEntry();
    const other = await closeOpenEntry({
      ...closeArgs(id, ALPHA_LAT, ALPHA_LON),
      staffId: '99999999-9999-4999-8999-999999999999',
    });
    expect(other).toBeNull();
    const still = await db.query(`SELECT status FROM attendance_entries WHERE id = $1`, [id]);
    expect(still.rows[0].status).toBe('open');
  });

  it('rolls back cleanly', async () => {
    await db.query(ROLLBACK);
    const c = await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='attendance_entries'
         AND column_name LIKE 'clock_out_aoi%'`, [SCHEMA]);
    expect(c.rowCount).toBe(0);
  });
});

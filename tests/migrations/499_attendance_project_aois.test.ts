if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const SCHEMA = 'mig499_attendance_project_aois_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
// PostGIS lives in public; the migration's tables must land in the scratch
// schema. Both need to be on the path, scratch first.
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA},public`)}`;
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD = readFileSync(join(SQL_DIR, '499_attendance_project_aois.sql'), 'utf8');
const ROLLBACK = readFileSync(join(SQL_DIR, 'rollback_499_attendance_project_aois.sql'), 'utf8');

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 1 });

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';

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
    work_date DATE NOT NULL
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

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.query('CREATE EXTENSION IF NOT EXISTS postgis');
});

afterAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.end();
  await admin.end();
});

beforeEach(async () => {
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
  await db.query(PREREQUISITES);
  await db.query(`INSERT INTO projects (id, project_name) VALUES
    ('${P1}','Alpha'), ('${P2}','Beta'), ('${P3}','Sparse')`);
  await db.query(ring(P1, -26.38, 27.81, 8));
  await db.query(ring(P2, -25.70, 28.41, 8));
  // Sparse: only 2 poles — below the minimum for an area.
  await db.query(`INSERT INTO poles (project_id, latitude, longitude)
    VALUES ('${P3}', -29.0, 24.0), ('${P3}', -29.001, 24.001)`);
});

async function applyForward(): Promise<void> {
  await db.query(FORWARD);
}

describe('migration 499 — project AOIs', () => {
  it('creates the table, the recording columns and the flag', async () => {
    await applyForward();
    const cols = await db.query(
      `SELECT column_name, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'attendance_entries'
          AND column_name LIKE 'clock_in_aoi%' ORDER BY column_name`, [SCHEMA]);
    expect(cols.rows.map((r) => r.column_name))
      .toEqual(['clock_in_aoi_distance_m', 'clock_in_aoi_project_id']);
    // Nullable on purpose: a clock-in with no GPS records no project.
    expect(cols.rows.every((r) => r.is_nullable === 'YES')).toBe(true);

    const flag = await db.query(
      `SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'staff'
          AND column_name = 'aoi_enforcement_enabled'`, [SCHEMA]);
    expect(flag.rows).toHaveLength(1);
    // Enforcement must be opt-in; a default of true would gate every worker.
    expect(flag.rows[0].column_default).toContain('false');
  });

  it('builds an AOI only for projects with enough poles', async () => {
    await applyForward();
    const r = await db.query('SELECT project_id::text, pole_count FROM project_aois ORDER BY pole_count');
    expect(r.rows.map((x) => x.project_id).sort()).toEqual([P1, P2].sort());
    // Sparse (2 poles) gets no AOI — a hull of 2 points is a line, and would
    // let a barely-surveyed project win "nearest" over a real site.
    expect(r.rows.map((x) => x.project_id)).not.toContain(P3);
  });

  it('excludes NaN coordinates instead of erroring on them', async () => {
    // ST_ConvexHull errors outright on NaN. The SA bounding box is what keeps
    // them out, because Postgres sorts numeric NaN above every non-NaN value.
    await db.query(`INSERT INTO poles (project_id, latitude, longitude)
      VALUES ('${P1}', 'NaN'::numeric, 'NaN'::numeric)`);
    await expect(applyForward()).resolves.not.toThrow();
    const r = await db.query(`SELECT pole_count FROM project_aois WHERE project_id = '${P1}'`);
    expect(Number(r.rows[0].pole_count)).toBe(8); // the NaN row is not counted
  });

  it('excludes coordinates outside South Africa', async () => {
    await db.query(`INSERT INTO poles (project_id, latitude, longitude)
      VALUES ('${P1}', 51.5, -0.12)`); // London
    await applyForward();
    const r = await db.query(`SELECT pole_count FROM project_aois WHERE project_id = '${P1}'`);
    expect(Number(r.rows[0].pole_count)).toBe(8);
  });

  it('is idempotent and refreshes the timestamp', async () => {
    await applyForward();
    const first = await db.query('SELECT project_id::text, computed_at FROM project_aois ORDER BY project_id');
    const n = await db.query('SELECT refresh_project_aois() AS n');
    expect(Number(n.rows[0].n)).toBe(2);
    const second = await db.query('SELECT project_id::text, computed_at FROM project_aois ORDER BY project_id');
    expect(second.rows.map((r) => r.project_id)).toEqual(first.rows.map((r) => r.project_id));
    expect(new Date(second.rows[0].computed_at).getTime())
      .toBeGreaterThanOrEqual(new Date(first.rows[0].computed_at).getTime());
  });

  it('drops an AOI when its project falls below the pole threshold', async () => {
    await applyForward();
    expect((await db.query('SELECT 1 FROM project_aois WHERE project_id = $1', [P2])).rowCount).toBe(1);
    // A stale hull that keeps matching clock-ins after its poles are gone is
    // worse than no hull at all.
    await db.query(`DELETE FROM poles WHERE project_id = '${P2}'`);
    await db.query('SELECT refresh_project_aois()');
    expect((await db.query('SELECT 1 FROM project_aois WHERE project_id = $1', [P2])).rowCount).toBe(0);
    expect((await db.query('SELECT 1 FROM project_aois WHERE project_id = $1', [P1])).rowCount).toBe(1);
  });

  it('answers a nearest-AOI lookup with 0 inside and a real distance outside', async () => {
    await applyForward();
    const inside = await db.query(`
      SELECT p.project_name, ROUND(ST_Distance(ST_SetSRID(ST_MakePoint(27.81,-26.38),4326)::geography, a.aoi)::numeric,1) AS d
      FROM project_aois a JOIN projects p ON p.id = a.project_id ORDER BY 2 LIMIT 1`);
    expect(inside.rows[0].project_name).toBe('Alpha');
    expect(Number(inside.rows[0].d)).toBe(0);

    const outside = await db.query(`
      SELECT p.project_name, ST_Distance(ST_SetSRID(ST_MakePoint(28.41,-25.70),4326)::geography, a.aoi) AS d
      FROM project_aois a JOIN projects p ON p.id = a.project_id ORDER BY 2 LIMIT 1`);
    expect(outside.rows[0].project_name).toBe('Beta');
  });

  it('rolls back cleanly', async () => {
    await applyForward();
    await db.query(ROLLBACK);
    const t = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name='project_aois'`, [SCHEMA]);
    expect(t.rowCount).toBe(0);
    const c = await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='attendance_entries'
         AND column_name LIKE 'clock_in_aoi%'`, [SCHEMA]);
    expect(c.rowCount).toBe(0);
    const f = await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='staff'
         AND column_name='aoi_enforcement_enabled'`, [SCHEMA]);
    expect(f.rowCount).toBe(0);
  });
});

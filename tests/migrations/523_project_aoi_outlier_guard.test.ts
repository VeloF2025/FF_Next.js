if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const SCHEMA = 'mig523_project_aoi_outlier_guard_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
// PostGIS lives in public; the migrations' tables must land in the scratch
// schema. Both need to be on the path, scratch first.
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA},public`)}`;
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const MIG_499 = readFileSync(join(SQL_DIR, '499_attendance_project_aois.sql'), 'utf8');
const MIG_523 = readFileSync(join(SQL_DIR, '523_project_aoi_outlier_guard.sql'), 'utf8');
const ROLLBACK_523 = readFileSync(join(SQL_DIR, 'rollback_523_project_aoi_outlier_guard.sql'), 'utf8');

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 1 });

const INCIDENT = '11111111-1111-4111-8111-111111111111';
const WIDE = '22222222-2222-4222-8222-222222222222';
const TIGHT = '33333333-3333-4333-8333-333333333333';
const TINY = '44444444-4444-4444-8444-444444444444';

// Column types, lengths and nullability mirror public.projects / public.poles /
// public.staff / public.attendance_entries on the shared production database
// (checked against information_schema on 2026-08-21). numeric(10,8) on latitude
// is load-bearing: it is what makes the migration's NaN-excluding BETWEEN
// meaningful, and a bare `numeric` fixture would not reproduce the rounding the
// real column applies to every coordinate.
const PREREQUISITES = `
  CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_code VARCHAR(50) NOT NULL,
    project_name VARCHAR(255) NOT NULL
  );
  CREATE TABLE poles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pole_number VARCHAR(100) NOT NULL,
    project_id UUID,
    latitude NUMERIC(10,8),
    longitude NUMERIC(11,8)
  );
  CREATE TABLE staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(50) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL
  );
  CREATE TABLE attendance_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL,
    work_date DATE NOT NULL,
    clock_in_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'open'
  );
`;

const DEG_PER_KM_LAT = 1 / 111.32;

/** Deterministic PRNG — a flaky fixture would make a threshold test meaningless. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * n poles uniformly distributed over a disc of the given radius. Uniform over
 * AREA (sqrt of the random radius), so the median pole-to-centroid distance is
 * ~0.71 x the radius rather than 0.5 x it — the shape a real survey has, and
 * the one the 8x-median rule was calibrated against.
 */
function disc(projectId: string, lat: number, lon: number, radiusKm: number, n: number, seed: number): string {
  const rand = rng(seed);
  const rows = Array.from({ length: n }, (_, i) => {
    const r = radiusKm * Math.sqrt(rand());
    const a = 2 * Math.PI * rand();
    const dLat = r * DEG_PER_KM_LAT * Math.cos(a);
    const dLon = (r * DEG_PER_KM_LAT * Math.sin(a)) / Math.cos((lat * Math.PI) / 180);
    return `('${projectId}-${i}', '${projectId}', ${(lat + dLat).toFixed(8)}, ${(lon + dLon).toFixed(8)})`;
  });
  return `INSERT INTO poles (pole_number, project_id, latitude, longitude) VALUES ${rows.join(',')};`;
}

/** One pole due south of a centre by the given distance. */
function farPole(projectId: string, lat: number, lon: number, km: number, label: string): string {
  return `INSERT INTO poles (pole_number, project_id, latitude, longitude)
    VALUES ('${label}', '${projectId}', ${(lat - km * DEG_PER_KM_LAT).toFixed(8)}, ${lon.toFixed(8)});`;
}

// The 2026-08-21 incident, to shape: a project of ~2,800 poles inside a 2.4 km
// radius, plus ONE pole 145 km away captured under QField's default name.
const INCIDENT_LAT = -26.02;
const INCIDENT_LON = 28.24;
const INCIDENT_OUTLIER_KM = 145;

interface AoiRow {
  project_id: string;
  pole_count: number;
  aoi_area_m2: string | null;
  robust_aoi_area_m2: string | null;
  aoi_area_ratio: string | null;
  outlier_pole_count: number;
  furthest_outlier_m: string | null;
  aoi_status: string;
}

async function readAoi(projectId: string): Promise<AoiRow | undefined> {
  const r = await db.query<AoiRow>(
    `SELECT project_id::text, pole_count, aoi_area_m2, robust_aoi_area_m2, aoi_area_ratio,
            outlier_pole_count, furthest_outlier_m, aoi_status
       FROM project_aois WHERE project_id = $1`,
    [projectId],
  );
  return r.rows[0];
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
  await db.query(`INSERT INTO projects (id, project_code, project_name) VALUES
    ('${INCIDENT}','INC','Incident replica'),
    ('${WIDE}','WID','Genuinely spread out'),
    ('${TIGHT}','TGT','Clean tight site'),
    ('${TINY}','TNY','Barely surveyed')`);
});

async function applyBoth(): Promise<void> {
  await db.query(MIG_499);
  await db.query(MIG_523);
}

describe('migration 523 — project AOI outlier guard', () => {
  it('adds the scoring columns with the nullability and default the design needs', async () => {
    await applyBoth();
    const cols = await db.query<{ column_name: string; is_nullable: string; column_default: string | null; data_type: string }>(
      `SELECT column_name, is_nullable, column_default, data_type
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'project_aois'
          AND column_name IN ('aoi_area_m2','robust_aoi_area_m2','aoi_area_ratio',
                              'outlier_pole_count','furthest_outlier_m','aoi_status')
        ORDER BY column_name`,
      [SCHEMA],
    );
    const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));
    expect(Object.keys(byName).sort()).toEqual([
      'aoi_area_m2', 'aoi_area_ratio', 'aoi_status', 'furthest_outlier_m', 'outlier_pole_count', 'robust_aoi_area_m2',
    ]);
    // The three measures are nullable because a robust hull is not always
    // derivable; a NOT NULL here would force a fabricated number.
    expect(byName.robust_aoi_area_m2.is_nullable).toBe('YES');
    expect(byName.aoi_area_ratio.is_nullable).toBe('YES');
    expect(byName.furthest_outlier_m.is_nullable).toBe('YES');
    // The two the application filters on are not: an absent status is
    // indistinguishable from a clean one.
    expect(byName.aoi_status.is_nullable).toBe('NO');
    expect(byName.aoi_status.column_default).toContain('unassessed');
    expect(byName.outlier_pole_count.is_nullable).toBe('NO');
    expect(byName.outlier_pole_count.column_default).toContain('0');
  });

  it('constrains aoi_status to the four documented values', async () => {
    await db.query(disc(TIGHT, -26.38, 27.81, 1.5, 40, 7));
    await applyBoth();
    // Prove the UPDATE reaches a row first — against an empty table this test
    // would pass for the wrong reason, since a 0-row UPDATE never checks a
    // constraint.
    const legal = await db.query(`UPDATE project_aois SET aoi_status = 'suspect'`);
    expect(legal.rowCount).toBe(1);
    await expect(
      db.query(`UPDATE project_aois SET aoi_status = 'probably-fine'`),
    ).rejects.toThrow(/project_aois_aoi_status_check/);
  });

  it('is idempotent — re-applying changes nothing', async () => {
    await db.query(disc(TIGHT, -26.38, 27.81, 1.5, 40, 7));
    await applyBoth();
    await expect(db.query(MIG_523)).resolves.not.toThrow();
    const row = await readAoi(TIGHT);
    expect(row?.aoi_status).toBe('ok');
  });

  describe('the 2026-08-21 incident', () => {
    beforeEach(async () => {
      await db.query(disc(INCIDENT, INCIDENT_LAT, INCIDENT_LON, 2.4, 2800, 42));
      await db.query(farPole(INCIDENT, INCIDENT_LAT, INCIDENT_LON, INCIDENT_OUTLIER_KM, 'New pole'));
    });

    it('flags the project as distorted and names the one pole responsible', async () => {
      await applyBoth();
      const row = await readAoi(INCIDENT);
      expect(row).toBeDefined();
      expect(row!.pole_count).toBe(2801);
      expect(row!.outlier_pole_count).toBe(1);
      expect(row!.aoi_status).toBe('distorted');
      // 145 km, to within the flattening error of a pure-latitude offset.
      expect(Number(row!.furthest_outlier_m) / 1000).toBeGreaterThan(140);
      expect(Number(row!.furthest_outlier_m) / 1000).toBeLessThan(150);
      // The real incident inflated the hull 63x. The exact multiple depends on
      // the cluster shape; what must hold is that it is an order of magnitude,
      // not a rounding difference.
      expect(Number(row!.aoi_area_ratio)).toBeGreaterThan(10);
      expect(Number(row!.aoi_area_m2)).toBeGreaterThan(Number(row!.robust_aoi_area_m2) * 10);
    });

    it('does NOT trim the outlier out of the hull the geofence uses', async () => {
      // The whole design decision, asserted. An AOI that is too small
      // over-accuses people in a system that feeds disciplinary findings, so
      // the guard measures the distortion and leaves the geometry alone for a
      // human to fix.
      await applyBoth();
      const far = await db.query<{ d: string }>(
        `SELECT ST_Distance(
                  ST_SetSRID(ST_MakePoint(p.longitude::float8, p.latitude::float8), 4326)::geography,
                  a.aoi) AS d
           FROM poles p JOIN project_aois a ON a.project_id = p.project_id
          WHERE p.pole_number = 'New pole'`,
      );
      expect(Number(far.rows[0].d)).toBe(0);
      // And the recorded full area is the untrimmed one.
      const row = await readAoi(INCIDENT);
      const hull = await db.query<{ a: string }>(
        `SELECT ST_Area(aoi) AS a FROM project_aois WHERE project_id = $1`, [INCIDENT]);
      expect(Number(row!.aoi_area_m2)).toBeCloseTo(Number(hull.rows[0].a), 0);
    });

    it('clears back to ok once the misassigned pole is corrected', async () => {
      await applyBoth();
      expect((await readAoi(INCIDENT))!.aoi_status).toBe('distorted');
      await db.query(`DELETE FROM poles WHERE pole_number = 'New pole'`);
      await db.query('SELECT refresh_project_aois()');
      const row = await readAoi(INCIDENT);
      expect(row!.aoi_status).toBe('ok');
      expect(row!.outlier_pole_count).toBe(0);
      expect(row!.furthest_outlier_m).toBeNull();
      expect(Number(row!.aoi_area_ratio)).toBe(1);
    });
  });

  it('does NOT flag a genuinely spread-out project', async () => {
    // 60 km across and nothing wrong with it. If the guard were "big project =
    // alarm" this would fail — and a flagged wide project is exactly the
    // pressure that leads someone to shrink a legitimate geofence.
    await db.query(disc(WIDE, -29.0, 24.0, 60, 1200, 99));
    await applyBoth();
    const row = await readAoi(WIDE);
    expect(row!.outlier_pole_count).toBe(0);
    expect(row!.aoi_status).toBe('ok');
    expect(Number(row!.aoi_area_ratio)).toBe(1);
    // Sanity: it really is a big area, ~4 orders of magnitude above a tight site.
    expect(Number(row!.aoi_area_m2) / 1e6).toBeGreaterThan(5000);
  });

  it('reports a clean tight site as ok with a ratio of exactly 1', async () => {
    await db.query(disc(TIGHT, -26.38, 27.81, 1.5, 400, 7));
    await applyBoth();
    const row = await readAoi(TIGHT);
    expect(row!.outlier_pole_count).toBe(0);
    expect(row!.aoi_status).toBe('ok');
    expect(Number(row!.aoi_area_ratio)).toBe(1);
    expect(row!.robust_aoi_area_m2).toBe(row!.aoi_area_m2);
  });

  it('does not flag a pole a kilometre down the road from a very tight cluster', async () => {
    // This is what the 5 km floor buys. Forty poles inside 50 m give a median
    // pole-to-centroid distance of ~35 m, so the 8x-median rule alone would call
    // anything past ~280 m an outlier — every second street corner. On the ratio
    // test alone this project would flag daily and the guard would be muted
    // within a week, which is how a real 145 km outlier gets missed.
    await db.query(disc(TIGHT, -26.38, 27.81, 0.05, 40, 11));
    await db.query(farPole(TIGHT, -26.38, 27.81, 1, 'TGT-down-the-road'));
    await applyBoth();
    const row = await readAoi(TIGHT);
    expect(row!.pole_count).toBe(41);
    expect(row!.outlier_pole_count).toBe(0);
    expect(row!.aoi_status).toBe('ok');
  });

  it('calls a project distorted when the outlier leaves too few poles to prove otherwise', async () => {
    // Two poles survive, so no robust hull exists. "Cannot show it is clean" is
    // not "is clean": the status must shout, not fall back to ok.
    await db.query(`INSERT INTO poles (pole_number, project_id, latitude, longitude) VALUES
      ('TNY-1','${TINY}', -26.02000000, 28.24000000),
      ('TNY-2','${TINY}', -26.02010000, 28.24010000)`);
    await db.query(farPole(TINY, -26.0201, 28.24, INCIDENT_OUTLIER_KM, 'TNY-far'));
    await applyBoth();
    const row = await readAoi(TINY);
    expect(row!.outlier_pole_count).toBe(1);
    expect(row!.robust_aoi_area_m2).toBeNull();
    expect(row!.aoi_area_ratio).toBeNull();
    expect(row!.aoi_status).toBe('distorted');
  });

  it('still excludes NaN and out-of-bounds coordinates from the scoring', async () => {
    // percentile_cont over NaN would poison the centroid, and ST_ConvexHull
    // errors on NaN outright. The SA bounding box from 499 is what keeps both
    // out; this asserts 523 did not widen it.
    await db.query(disc(TIGHT, -26.38, 27.81, 1.5, 40, 7));
    await db.query(`INSERT INTO poles (pole_number, project_id, latitude, longitude) VALUES
      ('NAN-1','${TIGHT}', 'NaN'::numeric, 'NaN'::numeric),
      ('LON-1','${TIGHT}', 51.50000000, -0.12000000)`);
    await expect(applyBoth()).resolves.not.toThrow();
    const row = await readAoi(TIGHT);
    expect(row!.pole_count).toBe(40);
    expect(row!.outlier_pole_count).toBe(0);
    expect(row!.aoi_status).toBe('ok');
  });

  it('rolls back to the migration 499 function and drops the columns', async () => {
    await db.query(disc(INCIDENT, INCIDENT_LAT, INCIDENT_LON, 2.4, 200, 42));
    await db.query(farPole(INCIDENT, INCIDENT_LAT, INCIDENT_LON, INCIDENT_OUTLIER_KM, 'New pole'));
    await applyBoth();
    await db.query(ROLLBACK_523);

    const cols = await db.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'project_aois'
          AND column_name IN ('aoi_area_m2','robust_aoi_area_m2','aoi_area_ratio',
                              'outlier_pole_count','furthest_outlier_m','aoi_status')`,
      [SCHEMA],
    );
    expect(cols.rowCount).toBe(0);
    const idx = await db.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = 'idx_project_aois_status'`, [SCHEMA]);
    expect(idx.rowCount).toBe(0);
    // The restored 499 function must still rebuild hulls, or the rollback has
    // traded a guard for an outage.
    const n = await db.query<{ n: number }>('SELECT refresh_project_aois() AS n');
    expect(Number(n.rows[0].n)).toBe(1);
    const still = await db.query('SELECT pole_count FROM project_aois WHERE project_id = $1', [INCIDENT]);
    expect(still.rowCount).toBe(1);
  });
});

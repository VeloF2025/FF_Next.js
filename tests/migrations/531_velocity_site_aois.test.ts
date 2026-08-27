/**
 * Contract for migration 531 (Velocity site AOIs for the Fleet monitor).
 *
 * The migration mirrors every `ok` hull in `project_aois` into
 * `fno_atlas_project_aois`, buffered 300 m, under a source of its own — the
 * standing site geometry the Fleet operational monitor covers vehicle and
 * attendance fixes against.
 *
 * Everything here runs against a real Postgres with PostGIS, applying the real
 * migration files. A stubbed geometry layer would be blind to exactly the
 * things that can go wrong: the column typmod (MultiPolygon, 4326), the
 * `ST_IsValid` check, the partial-unique arbiter, and whether a metre buffer
 * on a geography actually covers a point 200 m out.
 *
 * The buffer and the stale sweep are each pinned by a test that FAILS when the
 * clause is removed — see the PR body for the two mutations that were run.
 */
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const SCHEMA = 'mig531_velocity_site_aois_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
// PostGIS lives in public; the migrations' tables must land in the scratch
// schema. Both need to be on the path, scratch first.
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA},public`)}`;
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const read = (f: string): string => readFileSync(join(SQL_DIR, f), 'utf8');

const MIG_427 = read('427_fno_atlas_gis_foundation.sql');
const MIG_434 = read('434_fno_atlas_project_aois.sql');
const MIG_435 = read('435_fno_atlas_velocity_aoi_labels.sql');
const MIG_499 = read('499_attendance_project_aois.sql');
const MIG_523 = read('523_project_aoi_outlier_guard.sql');
const FORWARD = read('531_velocity_site_aois.sql');
const ROLLBACK = read('rollback_531_velocity_site_aois.sql');

const SOURCE_URL = 'fibreflow://project_aois';

const ALPHA = '51000000-0000-4000-8000-000000000001';
const BETA = '51000000-0000-4000-8000-000000000002';
const USER = '51000000-0000-4000-8000-000000000009';

/**
 * Column names, types and nullability mirror production
 * (`\d` against the shared database, 2026-08-27). `project_name` is
 * VARCHAR(255) and `project_code` VARCHAR(50) because the migration compares
 * `area_name` (TEXT) against them, and a TEXT fixture would not reproduce the
 * cast the real columns force.
 */
const PREREQUISITES = `
  CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE users (id UUID PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE);
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
  CREATE TABLE fleet_authorized_locations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL);
  INSERT INTO users (id, email) VALUES ('${USER}', 'migration-531@example.test');
`;

/**
 * Mirrors production's `fleet_project_operational_sites`, including the FK to
 * `fno_atlas_project_aois` with NO ACTION. That FK is the reason the sweep
 * retires referenced rows instead of deleting them, so a fixture without it
 * would let the retire branch pass for the wrong reason.
 */
const OPERATIONAL_SITES = `
  CREATE TABLE fleet_project_operational_sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id),
    display_name TEXT NOT NULL,
    project_aoi_id UUID REFERENCES fno_atlas_project_aois(id),
    authorized_location_id UUID REFERENCES fleet_authorized_locations(id),
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fleet_project_operational_sites_one_source_check
      CHECK (num_nonnulls(project_aoi_id, authorized_location_id) = 1)
  );
`;

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 1 });
const appUser = new Pool({
  connectionString: `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA},public -c role=fibreflow_user`)}`,
  ssl: false,
  max: 1,
});

const DEG_PER_KM_LAT = 1 / 111.32;

/** A compact ring of poles — enough for a hull, small enough to reason about. */
function poles(projectId: string, lat: number, lon: number, radiusKm: number, n: number): string {
  const rows: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const angle = (2 * Math.PI * i) / n;
    const dLat = radiusKm * DEG_PER_KM_LAT * Math.sin(angle);
    const dLon = (radiusKm * DEG_PER_KM_LAT * Math.cos(angle)) / Math.cos((lat * Math.PI) / 180);
    rows.push(`('P-${projectId.slice(-4)}-${i}', '${projectId}', ${(lat + dLat).toFixed(8)}, ${(lon + dLon).toFixed(8)})`);
  }
  return `INSERT INTO poles (pole_number, project_id, latitude, longitude) VALUES ${rows.join(',')};`;
}

async function atlasRows(): Promise<Array<Record<string, unknown>>> {
  const { rows } = await db.query(
    `SELECT a.id, a.site_code, a.area_name, a.area_kind, a.point_count, a.confidence,
            a.retired_at, a.raw_properties,
            ST_SRID(a.geom) AS srid, GeometryType(a.geom) AS geom_type, ST_IsValid(a.geom) AS valid
       FROM fno_atlas_project_aois a
       JOIN fno_atlas_sources s ON s.id = a.source_id
      WHERE s.source_url = $1
      ORDER BY a.area_name`,
    [SOURCE_URL],
  );
  return rows;
}

/** Rows the source owns that are still live — what every Fleet consumer sees. */
async function activeRows(): Promise<Array<Record<string, unknown>>> {
  return (await atlasRows()).filter((r) => r.retired_at === null);
}

/**
 * A point `metres` due east of the pole hull's easternmost vertex.
 *
 * Due east of the rightmost vertex of a convex hull is outside it, and that
 * vertex is the nearest point on the hull — so the distance from the hull is
 * exactly `metres`. Asserted below rather than assumed.
 */
async function pointOutsideHull(projectId: string, metres: number): Promise<{ wkt: string; distance: number }> {
  const { rows } = await db.query<{ wkt: string; distance: string }>(
    `WITH v AS (
       SELECT (ST_DumpPoints(aoi::geometry)).geom AS p FROM project_aois WHERE project_id = $1
     ), east AS (
       SELECT p FROM v ORDER BY ST_X(p) DESC LIMIT 1
     ), probe AS (
       SELECT ST_Project(east.p::geography, $2::float8, radians(90))::geometry AS g FROM east
     )
     SELECT ST_AsText(probe.g) AS wkt,
            ST_Distance(pa.aoi, probe.g::geography)::text AS distance
       FROM probe, project_aois pa WHERE pa.project_id = $1`,
    [projectId, metres],
  );
  const row = rows[0];
  if (!row) throw new Error(`no AOI for ${projectId}`);
  return { wkt: row.wkt, distance: Number(row.distance) };
}

async function covers(projectId: string, wkt: string): Promise<boolean> {
  const { rows } = await db.query<{ covered: boolean }>(
    `SELECT ST_Covers(a.geom, ST_GeomFromText($2, 4326)) AS covered
       FROM fno_atlas_project_aois a
       JOIN fno_atlas_sources s ON s.id = a.source_id
      WHERE s.source_url = $3 AND a.site_code = $1 AND a.retired_at IS NULL`,
    [projectId, wkt, SOURCE_URL],
  );
  return rows[0]?.covered === true;
}

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fibreflow_user') THEN
      CREATE ROLE fibreflow_user NOLOGIN;
    END IF;
  END $$;`);
  await admin.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO fibreflow_user`);
  await db.query(PREREQUISITES);
  await db.query(MIG_427);
  await db.query(MIG_434);
  await db.query(MIG_435);
  await db.query(MIG_499);
  await db.query(MIG_523);
  await db.query(OPERATIONAL_SITES);
}, 180_000);

afterAll(async () => {
  await appUser.end();
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

beforeEach(async () => {
  // Back to the pre-531 state, then a known pole register. Every assertion is
  // therefore a result of this migration rather than of a previous test.
  await db.query(ROLLBACK);
  await db.query('DELETE FROM fleet_project_operational_sites');
  await db.query('DELETE FROM project_aois');
  await db.query('DELETE FROM poles');
  await db.query('DELETE FROM projects');
  await db.query(
    `INSERT INTO projects (id, project_code, project_name) VALUES
       ('${ALPHA}', 'M531A', 'Migration 531 Alpha'),
       ('${BETA}', 'M531B', 'Migration 531 Beta')`,
  );
  await db.query(poles(ALPHA, -26.128196, 28.473396, 0.4, 12));
  await db.query(poles(BETA, -25.711868, 28.411118, 0.6, 12));
  await db.query('SELECT refresh_project_aois()');
});

describe('forward migration', () => {
  it('registers a source of its own, distinct from the OneMap ingest', async () => {
    await db.query(FORWARD);
    const { rows } = await db.query<{ id: string; source_name: string; source_type: string; access_method: string; is_active: boolean }>(
      `SELECT id, source_name, source_type, access_method, is_active
         FROM fno_atlas_sources WHERE source_url = $1`,
      [SOURCE_URL],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source_name: 'Velocity project site AOIs',
      source_type: 'manual',
      access_method: 'manual_upload',
      is_active: true,
    });
    // The uniqueness index is (source_id, site_code, area_name), so sharing a
    // source with the OneMap ingest is what would let a refresh here collide
    // with an ingest row. Every row this migration writes must carry the new
    // source and nothing else.
    const { rows: mine } = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM fno_atlas_project_aois WHERE source_id IS DISTINCT FROM $1`,
      [rows[0]?.id],
    );
    expect(Number(mine[0]?.n)).toBe(0);
    expect(rows[0]?.id).toBeTruthy();
  });

  it('writes one AOI per ok project, keyed on the project id', async () => {
    await db.query(FORWARD);
    const rows = await activeRows();
    expect(rows.map((r) => r.site_code).sort()).toEqual([ALPHA, BETA].sort());
    expect(rows.map((r) => r.area_name)).toEqual(['Migration 531 Alpha', 'Migration 531 Beta']);
    for (const row of rows) {
      expect(row.area_kind).toBe('velocity_site_aoi');
      expect(row.confidence).toBe('high');
      expect(row.point_count).toBe(12);
      expect(row.geom_type).toBe('MULTIPOLYGON');
      expect(Number(row.srid)).toBe(4326);
      expect(row.valid).toBe(true);
    }
  });

  it('populates immediately — the rows exist without waiting for the cron', async () => {
    expect(await activeRows()).toHaveLength(0);
    await db.query(FORWARD);
    expect(await activeRows()).toHaveLength(2);
  });

  it('skips a project whose hull is not ok', async () => {
    await db.query(`UPDATE project_aois SET aoi_status = 'distorted' WHERE project_id = $1`, [BETA]);
    await db.query(FORWARD);
    expect((await activeRows()).map((r) => r.site_code)).toEqual([ALPHA]);
  });
});

describe('the 300 m buffer', () => {
  /**
   * The proposal's validation, reproduced as an assertion: the pole hull alone
   * misses on-site clock-ins on the site's edge (Themb'elihle: 6 of 17 inside
   * the raw hull, 17 of 17 at 300 m). 200 m out must be inside; 500 m out must
   * not be, or the buffer has silently grown.
   */
  it('covers a point 200 m outside the pole hull', async () => {
    await db.query(FORWARD);
    const probe = await pointOutsideHull(ALPHA, 200);
    // Prove the fixture before trusting the assertion it feeds.
    expect(probe.distance).toBeGreaterThan(195);
    expect(probe.distance).toBeLessThan(205);
    expect(await covers(ALPHA, probe.wkt)).toBe(true);
  });

  it('does not cover a point 500 m outside the pole hull', async () => {
    await db.query(FORWARD);
    const probe = await pointOutsideHull(ALPHA, 500);
    expect(probe.distance).toBeGreaterThan(495);
    expect(probe.distance).toBeLessThan(505);
    expect(await covers(ALPHA, probe.wkt)).toBe(false);
  });

  it('records the buffer it used, so a changed value is visible in the data', async () => {
    await db.query(FORWARD);
    const rows = await activeRows();
    for (const row of rows) {
      expect((row.raw_properties as Record<string, unknown>).bufferMetres).toBe(300);
      expect((row.raw_properties as Record<string, unknown>).derivedFrom).toBe('project_aois');
    }
  });
});

describe('re-running the refresh', () => {
  it('upserts rather than duplicating', async () => {
    await db.query(FORWARD);
    const before = await activeRows();
    await db.query('SELECT refresh_velocity_site_aois()');
    await db.query('SELECT refresh_velocity_site_aois()');
    const after = await activeRows();
    expect(after).toHaveLength(before.length);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
  });

  it('moves the geometry when the pole register moves', async () => {
    await db.query(FORWARD);
    const { rows: before } = await db.query<{ area: string }>(
      `SELECT ST_Area(a.geom::geography)::text AS area FROM fno_atlas_project_aois a
        JOIN fno_atlas_sources s ON s.id = a.source_id
       WHERE s.source_url = $1 AND a.site_code = $2`,
      [SOURCE_URL, ALPHA],
    );
    // A pole 2 km out widens the hull without tripping 523's outlier scoring
    // (its floor is 5 km), so the row must grow.
    await db.query(
      `INSERT INTO poles (pole_number, project_id, latitude, longitude)
       VALUES ('P-widen', $1, -26.128196, 28.493396)`,
      [ALPHA],
    );
    await db.query('SELECT refresh_project_aois()');
    await db.query('SELECT refresh_velocity_site_aois()');
    const { rows: after } = await db.query<{ area: string; point_count: number }>(
      `SELECT ST_Area(a.geom::geography)::text AS area, a.point_count FROM fno_atlas_project_aois a
        JOIN fno_atlas_sources s ON s.id = a.source_id
       WHERE s.source_url = $1 AND a.site_code = $2`,
      [SOURCE_URL, ALPHA],
    );
    expect(Number(after[0]?.area)).toBeGreaterThan(Number(before[0]?.area));
    expect(after[0]?.point_count).toBe(13);
  });

  it('returns the number of AOIs written', async () => {
    await db.query(FORWARD);
    const { rows } = await db.query<{ refresh_velocity_site_aois: number }>(
      'SELECT refresh_velocity_site_aois()',
    );
    expect(Number(rows[0]?.refresh_velocity_site_aois)).toBe(2);
  });

  it('refuses to run without its source row rather than writing under NULL', async () => {
    await db.query(FORWARD);
    await db.query('DELETE FROM fno_atlas_project_aois');
    await db.query(`DELETE FROM fno_atlas_sources WHERE source_url = $1`, [SOURCE_URL]);
    await expect(db.query('SELECT refresh_velocity_site_aois()')).rejects.toThrow(
      /no fno_atlas_sources row/,
    );
  });
});

describe('stale rows', () => {
  it('deletes the row when the project stops having an ok hull', async () => {
    await db.query(FORWARD);
    expect(await activeRows()).toHaveLength(2);
    await db.query(`UPDATE project_aois SET aoi_status = 'suspect' WHERE project_id = $1`, [BETA]);
    await db.query('SELECT refresh_velocity_site_aois()');
    const rows = await atlasRows();
    expect(rows.map((r) => r.site_code)).toEqual([ALPHA]);
  });

  it('deletes the row when the project loses its poles entirely', async () => {
    await db.query(FORWARD);
    await db.query('DELETE FROM poles WHERE project_id = $1', [BETA]);
    await db.query('SELECT refresh_project_aois()');
    await db.query('SELECT refresh_velocity_site_aois()');
    expect((await atlasRows()).map((r) => r.site_code)).toEqual([ALPHA]);
  });

  it('replaces the row when the project is renamed, leaving no orphan', async () => {
    await db.query(FORWARD);
    await db.query(`UPDATE projects SET project_name = 'Migration 531 Renamed' WHERE id = $1`, [BETA]);
    await db.query('SELECT refresh_velocity_site_aois()');
    const rows = await activeRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.area_name).sort()).toEqual(['Migration 531 Alpha', 'Migration 531 Renamed']);
  });

  /**
   * The FK is NO ACTION, and linking these AOIs to operational sites is the
   * whole point of creating them — so a stale row a site references cannot be
   * deleted without aborting the entire refresh with 23503.
   */
  it('retires, rather than deletes, a stale row an operational site references', async () => {
    await db.query(FORWARD);
    const betaRow = (await activeRows()).find((r) => r.site_code === BETA);
    await db.query(
      `INSERT INTO fleet_project_operational_sites (project_id, display_name, project_aoi_id, created_by)
       VALUES ($1, 'Beta Site', $2, $3)`,
      [BETA, betaRow?.id, USER],
    );
    await db.query(`UPDATE project_aois SET aoi_status = 'distorted' WHERE project_id = $1`, [BETA]);

    await expect(db.query('SELECT refresh_velocity_site_aois()')).resolves.toBeTruthy();

    const all = await atlasRows();
    const retired = all.find((r) => r.site_code === BETA);
    expect(retired).toBeDefined();
    expect(retired?.retired_at).not.toBeNull();
    // Retired is what every Fleet consumer already filters on, so this removes
    // it from evidence exactly as a delete would.
    expect((await activeRows()).map((r) => r.site_code)).toEqual([ALPHA]);
  });

  it('leaves rows owned by another source untouched', async () => {
    await db.query(FORWARD);
    const { rows: src } = await db.query<{ id: string }>(
      `INSERT INTO fno_atlas_sources (source_name, source_url, source_type, access_method)
       VALUES ('Foreign ingest', 'https://example.test/ingest', 'official_map', 'api') RETURNING id`,
    );
    await db.query(
      `INSERT INTO fno_atlas_project_aois (source_id, site_code, area_name, point_count, geom)
       SELECT $1, 'not-a-project', 'Foreign Area', 5,
              ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(28.0, -26.0), 4326)::geography, 100)::geometry)::geometry(MultiPolygon,4326)`,
      [src[0]?.id],
    );
    await db.query('SELECT refresh_velocity_site_aois()');
    const { rows } = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM fno_atlas_project_aois WHERE source_id = $1`,
      [src[0]?.id],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });
});

describe('grants', () => {
  it('lets fibreflow_user execute the refresh and write its rows', async () => {
    await db.query(FORWARD);
    await db.query('DELETE FROM fno_atlas_project_aois');
    const client = await appUser.connect();
    try {
      const { rows } = await client.query<{ refresh_velocity_site_aois: number }>(
        'SELECT refresh_velocity_site_aois()',
      );
      expect(Number(rows[0]?.refresh_velocity_site_aois)).toBe(2);
    } finally {
      client.release();
    }
    expect(await activeRows()).toHaveLength(2);
  });

  it('lets fibreflow_user sweep a stale row', async () => {
    await db.query(FORWARD);
    await db.query(`UPDATE project_aois SET aoi_status = 'suspect' WHERE project_id = $1`, [BETA]);
    const client = await appUser.connect();
    try {
      await expect(client.query('SELECT refresh_velocity_site_aois()')).resolves.toBeTruthy();
    } finally {
      client.release();
    }
    expect((await activeRows()).map((r) => r.site_code)).toEqual([ALPHA]);
  });
});

describe('rollback', () => {
  it('removes the function, the rows and the source', async () => {
    await db.query(FORWARD);
    await db.query(ROLLBACK);
    expect(await atlasRows()).toHaveLength(0);
    const { rows: src } = await db.query(`SELECT id FROM fno_atlas_sources WHERE source_url = $1`, [SOURCE_URL]);
    expect(src).toHaveLength(0);
    await expect(db.query('SELECT refresh_velocity_site_aois()')).rejects.toThrow(/does not exist/);
  });

  it('is repeatable', async () => {
    await db.query(FORWARD);
    await db.query(ROLLBACK);
    await expect(db.query(ROLLBACK)).resolves.toBeTruthy();
  });

  it('keeps a referenced AOI rather than breaking the site that points at it', async () => {
    await db.query(FORWARD);
    const alphaRow = (await activeRows()).find((r) => r.site_code === ALPHA);
    await db.query(
      `INSERT INTO fleet_project_operational_sites (project_id, display_name, project_aoi_id, created_by)
       VALUES ($1, 'Alpha Site', $2, $3)`,
      [ALPHA, alphaRow?.id, USER],
    );
    await db.query(ROLLBACK);
    const remaining = await atlasRows();
    expect(remaining.map((r) => r.site_code)).toEqual([ALPHA]);
    expect(remaining[0]?.retired_at).not.toBeNull();
  });
});

describe('the forward migration is repeatable', () => {
  it('applies twice without error and without duplicating anything', async () => {
    await db.query(FORWARD);
    await db.query(FORWARD);
    expect(await activeRows()).toHaveLength(2);
    const { rows } = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM fno_atlas_sources WHERE source_url = $1`,
      [SOURCE_URL],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });
});

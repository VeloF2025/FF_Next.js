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
 * The buffer, the identity arbiter, the stale sweep and the EXECUTE grant are
 * each pinned by a test that FAILS when the clause is removed — see the PR
 * body for the mutation table.
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
/** The pinned source id the migration's uniqueness index is scoped to. */
const VELOCITY_SOURCE_ID = 'e0f1c0de-0000-4000-8000-000000000531';
/** A role with schema access but no EXECUTE grant — the REVOKE's other half. */
const NO_GRANT_ROLE = 'mig531_no_grant_probe';

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
const noGrantUser = new Pool({
  connectionString: `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA},public -c role=${NO_GRANT_ROLE}`)}`,
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

/**
 * Sites whose linked AOI is still live. This is the number that matters: every
 * Fleet consumer joins `retired_at IS NULL`, so a site pointing at a retired
 * row has silently lost its geometry and the monitor stops judging it.
 */
async function sitesWithLiveGeometry(): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM fleet_project_operational_sites s
       JOIN fno_atlas_project_aois a ON a.id = s.project_aoi_id
      WHERE a.retired_at IS NULL`,
  );
  return Number(rows[0]?.n ?? 0);
}

async function siteAoiId(siteId: string): Promise<string | null> {
  const { rows } = await db.query<{ project_aoi_id: string | null }>(
    `SELECT project_aoi_id FROM fleet_project_operational_sites WHERE id = $1`,
    [siteId],
  );
  return rows[0]?.project_aoi_id ?? null;
}

async function linkSite(projectId: string, aoiId: string, name: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO fleet_project_operational_sites (project_id, display_name, project_aoi_id, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [projectId, name, aoiId, USER],
  );
  return rows[0]!.id;
}

/**
 * A stand-in for the OneMap ingest: its own source, and one AOI whose geometry
 * is the project's raw pole hull. The raw hull is strictly inside the 300 m
 * buffer by construction, which is the containment the migration's relink step
 * checks with ST_Covers — the same relation measured on the real Lawley pair
 * (10.786 km² velocity, 7.715 km² OneMap, 0.000000 km² outside).
 */
async function seedIngestAoi(projectId: string, areaName: string): Promise<string> {
  const { rows: src } = await db.query<{ id: string }>(
    `INSERT INTO fno_atlas_sources (source_name, source_url, source_type, access_method)
     VALUES ('Velocity internal area AOIs', 'fibreflow://onemap_properties', 'manual', 'manual_upload')
     ON CONFLICT (source_url) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
  );
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO fno_atlas_project_aois (source_id, site_code, area_name, point_count, geom)
     SELECT $1, $2, $3, pa.pole_count,
            ST_Multi(ST_CollectionExtract(ST_MakeValid(pa.aoi::geometry), 3))::geometry(MultiPolygon,4326)
       FROM project_aois pa WHERE pa.project_id = $4
     RETURNING id`,
    [src[0]?.id, areaName, areaName, projectId],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  for (const role of ['fibreflow_user', NO_GRANT_ROLE]) {
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
        CREATE ROLE ${role} NOLOGIN;
      END IF;
    END $$;`);
    await admin.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO ${role}`);
  }
  await db.query(PREREQUISITES);
  await db.query(MIG_427);
  await db.query(MIG_434);
  await db.query(MIG_435);
  await db.query(MIG_499);
  await db.query(MIG_523);
  await db.query(OPERATIONAL_SITES);
  // The probe role gets EVERY table privilege the function needs and nothing
  // else — so the only thing that can stop it is the missing EXECUTE. Without
  // this it would fail on a table permission instead, and the test below would
  // pass whether or not the REVOKE existed. (It did: dropping the REVOKE left
  // that test green until this was added.)
  await db.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON fno_atlas_project_aois TO ${NO_GRANT_ROLE}`);
  await db.query(`GRANT SELECT, INSERT, UPDATE ON fno_atlas_sources TO ${NO_GRANT_ROLE}`);
  await db.query(`GRANT SELECT ON project_aois, projects, fleet_project_operational_sites TO ${NO_GRANT_ROLE}`);
}, 180_000);

afterAll(async () => {
  await noGrantUser.end();
  await appUser.end();
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

beforeEach(async () => {
  // Back to the pre-531 state, then a known pole register. Every assertion is
  // therefore a result of this migration rather than of a previous test.
  await db.query('DELETE FROM fleet_project_operational_sites');
  await db.query(ROLLBACK);
  await db.query('DELETE FROM fno_atlas_project_aois');
  await db.query(`DELETE FROM fno_atlas_sources`);
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
describe('stale rows are retired, never deleted', () => {
  it('retires the row when the project stops having an ok hull', async () => {
    await db.query(FORWARD);
    expect(await activeRows()).toHaveLength(2);
    await db.query(`UPDATE project_aois SET aoi_status = 'suspect' WHERE project_id = $1`, [BETA]);
    await db.query('SELECT refresh_velocity_site_aois()');
    expect((await activeRows()).map((r) => r.site_code)).toEqual([ALPHA]);
    // Retired, not gone: the row is still there for a link to point at, and
    // for the revival below to bring back.
    const all = await atlasRows();
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.site_code === BETA)?.retired_at).not.toBeNull();
  });

  it('retires the row when the project loses its poles entirely', async () => {
    await db.query(FORWARD);
    await db.query('DELETE FROM poles WHERE project_id = $1', [BETA]);
    await db.query('SELECT refresh_project_aois()');
    await db.query('SELECT refresh_velocity_site_aois()');
    expect((await activeRows()).map((r) => r.site_code)).toEqual([ALPHA]);
    expect(await atlasRows()).toHaveLength(2);
  });

  /**
   * The FK is NO ACTION. Deciding delete-vs-retire from an EXISTS check does
   * not close the race — the check and the delete read different snapshots, so
   * a site inserted in between still aborts the run. Retiring unconditionally
   * removes the window entirely; this reproduces the interleaving.
   */
  it('does not raise 23503 when a site is linked after the sweep would have decided', async () => {
    await db.query(FORWARD);
    const betaRow = (await activeRows()).find((r) => r.site_code === BETA);
    await db.query(`UPDATE project_aois SET aoi_status = 'distorted' WHERE project_id = $1`, [BETA]);

    // The link lands between "this row is stale" and the write that acts on it.
    await linkSite(BETA, String(betaRow?.id), 'Beta Site');

    await expect(db.query('SELECT refresh_velocity_site_aois()')).resolves.toBeTruthy();
    const retiredRow = (await atlasRows()).find((r) => r.site_code === BETA);
    expect(retiredRow?.retired_at).not.toBeNull();
    expect(await siteAoiId(String((await db.query<{ id: string }>(
      `SELECT id FROM fleet_project_operational_sites WHERE project_id = $1`, [BETA],
    )).rows[0]?.id))).toBe(betaRow?.id);
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
    const { rows } = await db.query<{ n: string; retired: string }>(
      `SELECT COUNT(*)::text AS n, COUNT(retired_at)::text AS retired
         FROM fno_atlas_project_aois WHERE source_id = $1`,
      [src[0]?.id],
    );
    expect(Number(rows[0]?.n)).toBe(1);
    expect(Number(rows[0]?.retired)).toBe(0);
  });
});

describe('identity: one live row per project, across renames and status round trips', () => {
  it('scopes its uniqueness index to the velocity source', async () => {
    await db.query(FORWARD);
    const { rows } = await db.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = $1 AND indexname = 'ux_fno_atlas_velocity_site_aois_active_site'`,
      [SCHEMA],
    );
    expect(rows).toHaveLength(1);
    // Scoped, so the OneMap ingest keeps its own (source_id, site_code,
    // area_name) identity and may still hold two live rows for one site_code.
    expect(rows[0]?.indexdef).toContain(VELOCITY_SOURCE_ID);
    expect(rows[0]?.indexdef).toContain('retired_at IS NULL');
  });

  it('updates the row in place when the project is renamed — the link survives', async () => {
    await db.query(FORWARD);
    const betaRow = (await activeRows()).find((r) => r.site_code === BETA);
    const siteId = await linkSite(BETA, String(betaRow?.id), 'Beta Site');
    expect(await sitesWithLiveGeometry()).toBe(1);

    await db.query(`UPDATE projects SET project_name = 'Migration 531 Renamed' WHERE id = $1`, [BETA]);
    await db.query('SELECT refresh_velocity_site_aois()');

    // Same row, new name — not a second row and a stranded link.
    expect(await siteAoiId(siteId)).toBe(betaRow?.id);
    expect(await sitesWithLiveGeometry()).toBe(1);
    const rows = await activeRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.area_name).sort()).toEqual(['Migration 531 Alpha', 'Migration 531 Renamed']);
    expect(await atlasRows()).toHaveLength(2);
  });

  it('renames back again without accumulating rows', async () => {
    await db.query(FORWARD);
    const before = (await activeRows()).find((r) => r.site_code === BETA);
    for (const name of ['Migration 531 Renamed', 'Migration 531 Beta']) {
      await db.query(`UPDATE projects SET project_name = $2 WHERE id = $1`, [BETA, name]);
      await db.query('SELECT refresh_velocity_site_aois()');
    }
    const after = (await activeRows()).find((r) => r.site_code === BETA);
    expect(after?.id).toBe(before?.id);
    expect(await atlasRows()).toHaveLength(2);
  });

  it('revives the same row on a distorted -> ok round trip — the link survives', async () => {
    await db.query(FORWARD);
    const betaRow = (await activeRows()).find((r) => r.site_code === BETA);
    const siteId = await linkSite(BETA, String(betaRow?.id), 'Beta Site');

    await db.query(`UPDATE project_aois SET aoi_status = 'distorted' WHERE project_id = $1`, [BETA]);
    await db.query('SELECT refresh_velocity_site_aois()');
    expect(await sitesWithLiveGeometry()).toBe(0);

    await db.query(`UPDATE project_aois SET aoi_status = 'ok' WHERE project_id = $1`, [BETA]);
    await db.query('SELECT refresh_velocity_site_aois()');

    expect(await siteAoiId(siteId)).toBe(betaRow?.id);
    expect(await sitesWithLiveGeometry()).toBe(1);
    // Revived, not duplicated.
    expect(await atlasRows()).toHaveLength(2);
    expect((await activeRows()).map((r) => r.site_code).sort()).toEqual([ALPHA, BETA].sort());
  });

  it('keeps every linked site on live geometry through rename and round trip together', async () => {
    await db.query(FORWARD);
    const rows = await activeRows();
    for (const row of rows) {
      await linkSite(String(row.site_code), String(row.id), `Site ${row.area_name}`);
    }
    expect(await sitesWithLiveGeometry()).toBe(2);

    await db.query(`UPDATE projects SET project_name = 'Renamed Alpha' WHERE id = $1`, [ALPHA]);
    await db.query(`UPDATE project_aois SET aoi_status = 'distorted' WHERE project_id = $1`, [BETA]);
    await db.query('SELECT refresh_velocity_site_aois()');
    await db.query(`UPDATE project_aois SET aoi_status = 'ok' WHERE project_id = $1`, [BETA]);
    await db.query('SELECT refresh_velocity_site_aois()');

    expect(await sitesWithLiveGeometry()).toBe(2);
    expect(await atlasRows()).toHaveLength(2);
  });

  it('refuses to run when the source id has drifted from the index it is scoped to', async () => {
    await db.query(FORWARD);
    await db.query('DELETE FROM fno_atlas_project_aois');
    await db.query(
      `UPDATE fno_atlas_sources SET id = gen_random_uuid() WHERE source_url = $1`,
      [SOURCE_URL],
    );
    await expect(db.query('SELECT refresh_velocity_site_aois()')).rejects.toThrow(
      /outside their own index/,
    );
  });
});

describe('repointing existing sites off the ingest AOI', () => {
  it('moves a site from the OneMap AOI onto the velocity AOI that covers it', async () => {
    const ingestAoi = await seedIngestAoi(ALPHA, 'Migration 531 Alpha');
    const siteId = await linkSite(ALPHA, ingestAoi, 'Alpha Site');

    await db.query(FORWARD);

    const velocityAlpha = (await activeRows()).find((r) => r.site_code === ALPHA);
    expect(await siteAoiId(siteId)).toBe(velocityAlpha?.id);
    expect(await sitesWithLiveGeometry()).toBe(1);
  });

  it('only repoints when the velocity AOI actually covers the old one', async () => {
    // An ingest AOI a long way from the project: containment fails, so the
    // link is left exactly where it was rather than silently moved.
    const { rows: src } = await db.query<{ id: string }>(
      `INSERT INTO fno_atlas_sources (source_name, source_url, source_type, access_method)
       VALUES ('Elsewhere ingest', 'fibreflow://elsewhere', 'manual', 'manual_upload') RETURNING id`,
    );
    const { rows: aoi } = await db.query<{ id: string }>(
      `INSERT INTO fno_atlas_project_aois (source_id, site_code, area_name, point_count, geom)
       VALUES ($1, 'elsewhere', 'Elsewhere', 3,
               ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(18.4, -33.9), 4326)::geography, 500)::geometry)::geometry(MultiPolygon,4326))
       RETURNING id`,
      [src[0]?.id],
    );
    const siteId = await linkSite(ALPHA, String(aoi[0]?.id), 'Alpha Site');

    await db.query(FORWARD);

    expect(await siteAoiId(siteId)).toBe(aoi[0]?.id);
  });

  it('leaves a site that already points at its velocity AOI alone', async () => {
    await db.query(FORWARD);
    const velocityAlpha = (await activeRows()).find((r) => r.site_code === ALPHA);
    const siteId = await linkSite(ALPHA, String(velocityAlpha?.id), 'Alpha Site');
    await db.query(FORWARD);
    expect(await siteAoiId(siteId)).toBe(velocityAlpha?.id);
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

  /**
   * EXECUTE defaults to PUBLIC, which would make the GRANT decorative and this
   * whole describe block vacuous. The REVOKE is what gives the grant meaning,
   * and this is the assertion that notices if it goes away.
   */
  it('refuses a role that was not granted EXECUTE, holding every table privilege it needs', async () => {
    await db.query(FORWARD);
    const client = await noGrantUser.connect();
    try {
      await expect(client.query('SELECT refresh_velocity_site_aois()')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      client.release();
    }
  });

  it('does not leave EXECUTE on PUBLIC', async () => {
    await db.query(FORWARD);
    const { rows } = await db.query<{ granted: boolean }>(
      `SELECT has_function_privilege('public', 'refresh_velocity_site_aois()', 'EXECUTE') AS granted`,
    );
    expect(rows[0]?.granted).toBe(false);
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

  it('drops the identity index', async () => {
    await db.query(FORWARD);
    await db.query(ROLLBACK);
    const { rows } = await db.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = $1 AND indexname = 'ux_fno_atlas_velocity_site_aois_active_site'`,
      [SCHEMA],
    );
    expect(rows).toHaveLength(0);
  });

  it('puts a repointed site back on its ingest AOI', async () => {
    const ingestAoi = await seedIngestAoi(ALPHA, 'Migration 531 Alpha');
    const siteId = await linkSite(ALPHA, ingestAoi, 'Alpha Site');
    await db.query(FORWARD);
    expect(await siteAoiId(siteId)).not.toBe(ingestAoi);

    await db.query(ROLLBACK);

    expect(await siteAoiId(siteId)).toBe(ingestAoi);
    expect(await sitesWithLiveGeometry()).toBe(1);
    // Nothing left behind once the link moved off it.
    expect(await atlasRows()).toHaveLength(0);
  });

  it('keeps a referenced AOI rather than breaking the site that points at it', async () => {
    // No ingest AOI to fall back to, so the link cannot be moved. The row is
    // retired and kept rather than deleted out from under the FK.
    await db.query(FORWARD);
    const alphaRow = (await activeRows()).find((r) => r.site_code === ALPHA);
    await linkSite(ALPHA, String(alphaRow?.id), 'Alpha Site');
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

#!/usr/bin/env tsx

import fs from 'node:fs';
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
if (!process.env.DATABASE_URL && fs.existsSync('/home/velo/fibreflow-dev/.env.local')) {
  dotenv.config({ path: '/home/velo/fibreflow-dev/.env.local' });
}
dotenv.config();

type AoiSummaryRow = {
  site_code: string;
  area_name: string;
  point_count: number;
  km2: string;
  confidence: string;
};

const SOURCE_NAME = 'Velocity internal area AOIs';
const SOURCE_URL = 'fibreflow://onemap_properties';
const DRY_RUN = process.argv.includes('--dry-run');
const MIN_POINTS = 30;
const BUFFER_METRES = 50;
const HULL_RATIO = 0.85;

function requireWriteApproval() {
  if (!DRY_RUN && process.env.ALLOW_FNO_ATLAS_DB_WRITE !== '1') {
    throw new Error('Refusing DB writes. Set ALLOW_FNO_ATLAS_DB_WRITE=1 or run with --dry-run.');
  }
}

function databaseUrl(): string {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL or MIGRATION_DATABASE_URL is required');
  return url;
}

async function ensureSource(client: Client, operatorId: string): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM fno_atlas_sources WHERE operator_id = $1 AND source_url = $2 LIMIT 1`,
    [operatorId, SOURCE_URL],
  );
  if (existing.rows[0]) {
    await client.query(
      `UPDATE fno_atlas_sources
          SET source_name = $2,
              source_type = 'manual',
              access_method = 'manual_upload',
              terms_notes = $3,
              priority = 60,
              is_active = true,
              last_checked_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [
        existing.rows[0].id,
        SOURCE_NAME,
        'Internal Velocity GPS-derived AOI polygons. Area-only layer; does not expose demand points and is not official FNO-published coverage.',
      ],
    );
    return existing.rows[0].id;
  }

  const result = await client.query<{ id: string }>(
    `INSERT INTO fno_atlas_sources (
       operator_id, source_name, source_url, source_type, access_method, terms_notes,
       priority, is_active, last_checked_at, updated_at
     ) VALUES ($1, $2, $3, 'manual', 'manual_upload', $4, 60, true, NOW(), NOW())
     RETURNING id`,
    [
      operatorId,
      SOURCE_NAME,
      SOURCE_URL,
      'Internal Velocity GPS-derived AOI polygons. Area-only layer; does not expose demand points and is not official FNO-published coverage.',
    ],
  );
  return result.rows[0].id;
}

async function createRun(client: Client, sourceId: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO fno_atlas_ingestion_runs (source_id, run_status, records_seen, source_snapshot, created_by)
     VALUES ($1, 'started', 0, $2::jsonb, 'ingest-onemap-project-aois')
     RETURNING id`,
    [
      sourceId,
      JSON.stringify({
        source: SOURCE_URL,
        minPoints: MIN_POINTS,
        hullRatio: HULL_RATIO,
        bufferMetres: BUFFER_METRES,
        granularity: 'site_only',
        exposesDemandPoints: false,
        overwritesProjects: false,
        method: 'site_all_coordinates_concave_hull',
      }),
    ],
  );
  return result.rows[0].id;
}

async function preview(client: Client): Promise<AoiSummaryRow[]> {
  const result = await client.query<AoiSummaryRow>(
    `WITH valid_points AS (
       SELECT site AS site_code,
              ST_Transform(ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326), 3857) AS geom_3857
         FROM onemap_properties
        WHERE site IS NOT NULL
          AND btrim(site) <> ''
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
          AND latitude BETWEEN -35.5 AND -21.5
          AND longitude BETWEEN 16.0 AND 33.5
     ), grouped AS (
       SELECT site_code,
              COUNT(*)::int AS point_count,
              ST_Multi(ST_Transform(ST_Buffer(ST_ConcaveHull(ST_Collect(geom_3857), $1, true), $2), 4326)) AS geom
         FROM valid_points
        GROUP BY site_code
       HAVING COUNT(*) >= $3
     )
     SELECT site_code,
            site_code AS area_name,
            point_count,
            ROUND((ST_Area(geom::geography) / 1000000)::numeric, 2)::text AS km2,
            CASE
              WHEN point_count >= 1000 THEN 'high'
              WHEN point_count >= 100 THEN 'medium'
              ELSE 'low'
            END AS confidence
       FROM grouped
      WHERE ST_IsValid(geom)
        AND NOT ST_IsEmpty(geom)
      ORDER BY point_count DESC, site_code
      LIMIT 200`,
    [HULL_RATIO, BUFFER_METRES, MIN_POINTS],
  );
  return result.rows;
}

async function importAois(client: Client, operatorId: string, sourceId: string, runId: string): Promise<number> {
  await client.query(
    `UPDATE fno_atlas_project_aois
        SET retired_at = NOW(), updated_at = NOW()
      WHERE source_id = $1
        AND retired_at IS NULL`,
    [sourceId],
  );

  const result = await client.query<{ inserted: number }>(
    `WITH valid_points AS (
       SELECT site AS site_code,
              status,
              ST_Transform(ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326), 3857) AS geom_3857
         FROM onemap_properties
        WHERE site IS NOT NULL
          AND btrim(site) <> ''
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
          AND latitude BETWEEN -35.5 AND -21.5
          AND longitude BETWEEN 16.0 AND 33.5
     ), status_counts AS (
       SELECT site_code,
              jsonb_object_agg(status, status_count) FILTER (WHERE status IS NOT NULL) AS status_counts
         FROM (
           SELECT site_code, status, COUNT(*)::int AS status_count
             FROM valid_points
            WHERE status IS NOT NULL
            GROUP BY site_code, status
         ) counts
        GROUP BY site_code
     ), grouped AS (
       SELECT site_code,
              COUNT(*)::int AS point_count,
              ST_Multi(ST_Transform(ST_Buffer(ST_ConcaveHull(ST_Collect(geom_3857), $1, true), $2), 4326)) AS geom
         FROM valid_points
        GROUP BY site_code
       HAVING COUNT(*) >= $3
     ), named AS (
       SELECT site_code,
              site_code AS area_name,
              point_count,
              CASE
                WHEN point_count >= 1000 THEN 'high'
                WHEN point_count >= 100 THEN 'medium'
                ELSE 'low'
              END AS confidence,
              geom,
              jsonb_build_object(
                'sourceTable', 'internal_gps_properties',
                'granularity', 'site_only',
                'exposesDemandPoints', false,
                'overwritesProjects', false,
                'method', 'site_all_coordinates_concave_hull',
                'hullRatio', $1,
                'bufferMetres', $2,
                'pointCount', point_count,
                'statusCounts', COALESCE(status_counts, '{}'::jsonb),
                'label', 'Velocity AOI - not official FNO-published coverage'
              ) AS raw_properties
         FROM grouped
         LEFT JOIN status_counts USING (site_code)
        WHERE ST_IsValid(geom)
          AND NOT ST_IsEmpty(geom)
     ), inserted AS (
       INSERT INTO fno_atlas_project_aois (
         operator_id, source_id, ingestion_run_id, site_code, area_name, area_kind,
         point_count, confidence, geom, raw_properties, first_seen_at, last_seen_at
       )
       SELECT $5, $4, $6, site_code, area_name, 'velocity_site_aoi', point_count,
              confidence, geom, raw_properties, NOW(), NOW()
         FROM named
       RETURNING id
     )
     SELECT COUNT(*)::int AS inserted FROM inserted`,
    [HULL_RATIO, BUFFER_METRES, MIN_POINTS, sourceId, operatorId, runId],
  );
  return result.rows[0].inserted;
}

async function main() {
  requireWriteApproval();
  const client = new Client({ connectionString: databaseUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const operator = await client.query<{ id: string }>(`SELECT id FROM fno_atlas_operators WHERE slug = 'fibertime' LIMIT 1`);
    if (!operator.rows[0]) throw new Error('fibertime operator not found in fno_atlas_operators');
    const operatorId = operator.rows[0].id;

    const rows = await preview(client);
    console.log(`Velocity AOI preview: ${rows.length} area polygons would be generated`);
    console.table(rows.slice(0, 25));
    if (DRY_RUN) return;

    await client.query('BEGIN');
    const sourceId = await ensureSource(client, operatorId);
    const runId = await createRun(client, sourceId);
    const inserted = await importAois(client, operatorId, sourceId, runId);
    await client.query(
      `UPDATE fno_atlas_ingestion_runs
          SET run_status = 'success', finished_at = NOW(), records_seen = $2, records_imported = $2
        WHERE id = $1`,
      [runId, inserted],
    );
    await client.query('COMMIT');
    console.log(`Inserted ${inserted} Velocity AOI area polygons`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

#!/usr/bin/env tsx

import fs from 'node:fs';
import util from 'node:util';
import { Client } from 'pg';
import dotenv from 'dotenv';

type OverlaySummary = {
  match_type: string;
  count: number;
  avg_fit_score: string | null;
};

function writeLine(value: unknown): void {
  process.stdout.write(`${typeof value === 'string' ? value : util.inspect(value, { depth: 4 })}\n`);
}

function loadEnv(): void {
  const envFile = process.env.FF_ENV_FILE || '/home/velo/fibreflow-dev/.env.local';
  if (fs.existsSync(envFile)) dotenv.config({ path: envFile, quiet: true });
}

function connectionString(): string {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL or MIGRATION_DATABASE_URL is required');
  return url;
}

function assertWriteAllowed(): boolean {
  if (process.argv.includes('--dry-run')) return false;
  if (process.env.ALLOW_FNO_ATLAS_DB_WRITE !== '1') {
    throw new Error('Refusing DB writes. Set ALLOW_FNO_ATLAS_DB_WRITE=1 or pass --dry-run.');
  }
  return true;
}

function nearRadiusMeters(): number {
  const raw = Number(process.env.FNO_ATLAS_NEAR_RADIUS_M || '10000');
  if (!Number.isFinite(raw) || raw <= 0) throw new Error('FNO_ATLAS_NEAR_RADIUS_M must be positive');
  return raw;
}

async function preview(client: Client): Promise<void> {
  const rows = await client.query(
    `WITH drop_points AS (
       SELECT project_id,
         ST_Centroid(ST_Collect(ST_SetSRID(ST_MakePoint(longitude::float8, latitude::float8), 4326))) AS geom,
         COUNT(*) AS gps_drop_count
       FROM drops
       WHERE project_id IS NOT NULL
         AND latitude BETWEEN -35 AND -22
         AND longitude BETWEEN 16 AND 33
       GROUP BY project_id
     ), project_points AS (
       SELECT p.id, p.project_code, p.project_name,
         COALESCE(
           CASE WHEN p.latitude BETWEEN -35 AND -22 AND p.longitude BETWEEN 16 AND 33
             THEN ST_SetSRID(ST_MakePoint(p.longitude::float8, p.latitude::float8), 4326)
           END,
           dp.geom
         ) AS geom,
         COALESCE(dp.gps_drop_count, 0) AS gps_drop_count
       FROM projects p
       LEFT JOIN drop_points dp ON dp.project_id = p.id
     )
     SELECT project_code, project_name, gps_drop_count
     FROM project_points
     WHERE geom IS NOT NULL
     ORDER BY gps_drop_count DESC, project_code`,
  );
  writeLine(rows.rows);
}

async function insertPolygonOverlays(client: Client, radiusM: number): Promise<void> {
  await client.query(
    `WITH drop_points AS (
       SELECT project_id,
         ST_Centroid(ST_Collect(ST_SetSRID(ST_MakePoint(longitude::float8, latitude::float8), 4326))) AS geom,
         COUNT(*) AS gps_drop_count
       FROM drops
       WHERE project_id IS NOT NULL
         AND latitude BETWEEN -35 AND -22
         AND longitude BETWEEN 16 AND 33
       GROUP BY project_id
     ), project_points AS (
       SELECT p.id, p.project_code, p.project_name,
         COALESCE(
           CASE WHEN p.latitude BETWEEN -35 AND -22 AND p.longitude BETWEEN 16 AND 33
             THEN ST_SetSRID(ST_MakePoint(p.longitude::float8, p.latitude::float8), 4326)
           END,
           dp.geom
         ) AS geom,
         COALESCE(dp.gps_drop_count, 0) AS gps_drop_count
       FROM projects p
       LEFT JOIN drop_points dp ON dp.project_id = p.id
     ), coverage_ops AS (
       SELECT DISTINCT o.id, o.slug, o.name
       FROM fno_atlas_operators o
       JOIN fno_atlas_coverage_areas ca ON ca.operator_id = o.id
     ), candidates AS (
       SELECT pp.id AS project_id, pp.project_code, pp.project_name, pp.gps_drop_count,
         co.id AS operator_id, co.slug AS operator_slug, co.name AS operator_name,
         nearest.coverage_area_id, nearest.distance_m, nearest.is_inside
       FROM project_points pp
       CROSS JOIN coverage_ops co
       LEFT JOIN LATERAL (
         SELECT ca.id AS coverage_area_id,
           ST_Distance(ca.geom::geography, pp.geom::geography) AS distance_m,
           ST_Covers(ca.geom, pp.geom) AS is_inside
         FROM fno_atlas_coverage_areas ca
         WHERE ca.operator_id = co.id
         ORDER BY ca.geom <-> pp.geom
         LIMIT 1
       ) nearest ON TRUE
       WHERE pp.geom IS NOT NULL
     )
     INSERT INTO fno_atlas_project_overlays (
       project_id, project_code, operator_id, coverage_area_id, match_type,
       distance_m, fit_score, evidence
     )
     SELECT project_id, project_code, operator_id, coverage_area_id,
       CASE WHEN is_inside THEN 'inside_coverage'
         WHEN distance_m <= $1 THEN 'near_coverage'
         ELSE 'no_match' END,
       ROUND(distance_m::numeric, 2),
       CASE WHEN is_inside THEN 100
         WHEN distance_m <= $1 THEN ROUND(GREATEST(0, 80 - (distance_m / $1 * 50))::numeric, 2)
         ELSE 0 END,
       jsonb_build_object(
         'projectName', project_name,
         'operatorSlug', operator_slug,
         'operatorName', operator_name,
         'gpsDropCount', gps_drop_count,
         'nearRadiusM', $1,
         'basis', 'nearest source-backed fno_atlas_coverage_areas polygon'
       )
     FROM candidates`,
    [radiusM],
  );
}

async function insertPresenceOverlays(client: Client, radiusM: number): Promise<void> {
  await client.query(
    `WITH drop_points AS (
       SELECT project_id,
         ST_Centroid(ST_Collect(ST_SetSRID(ST_MakePoint(longitude::float8, latitude::float8), 4326))) AS geom,
         COUNT(*) AS gps_drop_count
       FROM drops
       WHERE project_id IS NOT NULL
         AND latitude BETWEEN -35 AND -22
         AND longitude BETWEEN 16 AND 33
       GROUP BY project_id
     ), project_points AS (
       SELECT p.id, p.project_code, p.project_name,
         COALESCE(
           CASE WHEN p.latitude BETWEEN -35 AND -22 AND p.longitude BETWEEN 16 AND 33
             THEN ST_SetSRID(ST_MakePoint(p.longitude::float8, p.latitude::float8), 4326)
           END,
           dp.geom
         ) AS geom,
         COALESCE(dp.gps_drop_count, 0) AS gps_drop_count
       FROM projects p
       LEFT JOIN drop_points dp ON dp.project_id = p.id
     ), presence_ops AS (
       SELECT DISTINCT o.id, o.slug, o.name
       FROM fno_atlas_operators o
       JOIN fno_atlas_presence_points pp ON pp.operator_id = o.id
     ), candidates AS (
       SELECT pp.id AS project_id, pp.project_code, pp.project_name, pp.gps_drop_count,
         po.id AS operator_id, po.slug AS operator_slug, po.name AS operator_name,
         nearest.presence_point_id, nearest.point_name, nearest.distance_m
       FROM project_points pp
       CROSS JOIN presence_ops po
       LEFT JOIN LATERAL (
         SELECT fp.id AS presence_point_id, fp.point_name,
           ST_Distance(fp.geom::geography, pp.geom::geography) AS distance_m
         FROM fno_atlas_presence_points fp
         WHERE fp.operator_id = po.id
         ORDER BY fp.geom <-> pp.geom
         LIMIT 1
       ) nearest ON TRUE
       WHERE pp.geom IS NOT NULL
     )
     INSERT INTO fno_atlas_project_overlays (
       project_id, project_code, operator_id, coverage_area_id, match_type,
       distance_m, fit_score, evidence
     )
     SELECT project_id, project_code, operator_id, NULL,
       CASE WHEN distance_m <= $1 THEN 'near_presence_point' ELSE 'no_match' END,
       ROUND(distance_m::numeric, 2),
       CASE WHEN distance_m <= $1 THEN ROUND(GREATEST(0, 70 - (distance_m / $1 * 40))::numeric, 2)
         ELSE 0 END,
       jsonb_build_object(
         'projectName', project_name,
         'operatorSlug', operator_slug,
         'operatorName', operator_name,
         'nearestPresencePoint', point_name,
         'presencePointId', presence_point_id,
         'gpsDropCount', gps_drop_count,
         'nearRadiusM', $1,
         'basis', 'nearest source-backed fno_atlas_presence_points marker; not a polygon boundary'
       )
     FROM candidates`,
    [radiusM],
  );
}

async function compute(client: Client, radiusM: number): Promise<OverlaySummary[]> {
  await client.query('BEGIN');
  try {
    await client.query('DELETE FROM fno_atlas_project_overlays');
    await insertPolygonOverlays(client, radiusM);
    await insertPresenceOverlays(client, radiusM);
    const summary = await client.query<OverlaySummary>(
      `SELECT match_type, COUNT(*)::int, ROUND(AVG(fit_score), 2)::text AS avg_fit_score
       FROM fno_atlas_project_overlays
       GROUP BY match_type
       ORDER BY match_type`,
    );
    await client.query('COMMIT');
    return summary.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main(): Promise<void> {
  loadEnv();
  const write = assertWriteAllowed();
  const client = new Client({ connectionString: connectionString(), ssl: false });
  await client.connect();
  try {
    const radiusM = nearRadiusMeters();
    if (!write) {
      await preview(client);
      return;
    }
    writeLine(await compute(client, radiusM));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

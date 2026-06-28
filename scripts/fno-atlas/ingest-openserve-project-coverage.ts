#!/usr/bin/env tsx

import fs from 'node:fs';
import util from 'node:util';
import { Client } from 'pg';
import dotenv from 'dotenv';

type ProjectPoint = {
  project_code: string;
  project_name: string;
  gps_drop_count: string;
  lat: string;
  lon: string;
};

type ArcGisFeature = {
  attributes: Record<string, unknown>;
  geometry?: {
    rings?: number[][][];
  };
};

type ArcGisQueryResponse = {
  objectIds?: number[];
  features?: ArcGisFeature[];
  error?: { message?: string; details?: string[] };
};

type IngestionSummary = {
  project_points: number;
  records_seen: number;
  records_imported: number;
  radius_m: number;
};

const SOURCE_URL = 'https://gis.telkom.co.za/arcgis/rest/services/isp/FTTH_SRID4148_GN1/MapServer/1';
const COVERAGE_PAGE_URL = 'https://www.openserve.co.za/coverage';
const USER_AGENT = 'FibreFlow FNO Atlas Openserve ArcGIS ingestion/1.0';
const DEFAULT_RADIUS_M = 5000;
const FETCH_CHUNK_SIZE = 100;

function writeLine(value: unknown): void {
  process.stdout.write(`${typeof value === 'string' ? value : util.inspect(value, { depth: 5 })}\n`);
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

function ingestionRadiusM(): number {
  const raw = Number(process.env.FNO_ATLAS_OPENSERVE_RADIUS_M || DEFAULT_RADIUS_M);
  if (!Number.isFinite(raw) || raw <= 0) throw new Error('FNO_ATLAS_OPENSERVE_RADIUS_M must be positive');
  return raw;
}

async function fetchJson<T>(url: string, params: Record<string, string | number | boolean>): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  const response = await fetch(`${url}?${query.toString()}`, {
    headers: { 'user-agent': USER_AGENT, referer: COVERAGE_PAGE_URL },
  });
  if (!response.ok) throw new Error(`Openserve ArcGIS fetch failed ${response.status} for ${url}`);
  const json = (await response.json()) as T;
  const error = (json as ArcGisQueryResponse).error;
  if (error) throw new Error(`Openserve ArcGIS error: ${error.message || 'unknown'} ${error.details?.join('; ') || ''}`);
  return json;
}

async function loadProjectPoints(client: Client): Promise<ProjectPoint[]> {
  const rows = await client.query<ProjectPoint>(
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
       SELECT p.project_code, p.project_name,
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
     SELECT project_code, project_name, gps_drop_count::text,
       ST_Y(geom)::text AS lat,
       ST_X(geom)::text AS lon
     FROM project_points
     WHERE geom IS NOT NULL
     ORDER BY gps_drop_count DESC, project_code`,
  );
  return rows.rows;
}

function envelopeForPoint(point: ProjectPoint, radiusM: number): string {
  const lat = Number(point.lat);
  const lon = Number(point.lon);
  const latDelta = radiusM / 111_000;
  const lonDelta = radiusM / (111_000 * Math.max(0.1, Math.abs(Math.cos((lat * Math.PI) / 180))));
  return JSON.stringify({
    xmin: lon - lonDelta,
    ymin: lat - latDelta,
    xmax: lon + lonDelta,
    ymax: lat + latDelta,
    spatialReference: { wkid: 4326 },
  });
}

async function fetchObjectIdsForProject(point: ProjectPoint, radiusM: number): Promise<number[]> {
  const json = await fetchJson<ArcGisQueryResponse>(`${SOURCE_URL}/query`, {
    where: '1=1',
    returnIdsOnly: true,
    f: 'json',
    geometry: envelopeForPoint(point, radiusM),
    geometryType: 'esriGeometryEnvelope',
    inSR: 4326,
    spatialRel: 'esriSpatialRelIntersects',
  });
  return json.objectIds || [];
}

async function fetchFeatures(objectIds: number[]): Promise<ArcGisFeature[]> {
  if (objectIds.length === 0) return [];
  const json = await fetchJson<ArcGisQueryResponse>(`${SOURCE_URL}/query`, {
    objectIds: objectIds.join(','),
    outFields: 'OBJECTID,EA,CBS_SPLITTER_CODE,STATUS,QUERYURL_FSB',
    returnGeometry: true,
    outSR: 4326,
    f: 'json',
  });
  return json.features || [];
}

function ringToPolygonGeoJson(ring: number[][]): string | null {
  if (ring.length < 4) return null;
  const closed = [...ring];
  const first = closed[0];
  const last = closed[closed.length - 1];
  if (!first || !last) return null;
  if (first[0] !== last[0] || first[1] !== last[1]) closed.push(first);
  return JSON.stringify({ type: 'MultiPolygon', coordinates: [[closed]] });
}

function featureName(attributes: Record<string, unknown>): string {
  return String(attributes.CBS_SPLITTER_CODE || attributes.EA || attributes.OBJECTID || 'Openserve FTTH');
}

function rolloutStatus(attributes: Record<string, unknown>): string {
  const status = String(attributes.STATUS || '').toUpperCase();
  if (status.includes('WORKING')) return 'live';
  if (status.includes('PREORDER')) return 'planned';
  return 'unknown';
}

async function upsertSource(client: Client): Promise<string> {
  const source = await client.query<{ id: string }>(
    `INSERT INTO fno_atlas_sources (
       operator_id, source_name, source_url, source_type, access_method, priority, terms_notes, last_checked_at
     )
     SELECT id,
       'Openserve official ArcGIS FTTH FSB layer',
       $1::text,
       'official_api',
       'api',
       8,
       'Official Openserve coverage page exposes Telkom GIS ArcGIS FTTH FSB polygon layer. Ingestion is scoped to FibreFlow project buffers to avoid loading the national 120k-feature layer in one pass.',
       NOW()
     FROM fno_atlas_operators
     WHERE slug = 'openserve'
     ON CONFLICT (source_url) DO UPDATE SET
       source_name = EXCLUDED.source_name,
       operator_id = EXCLUDED.operator_id,
       source_type = EXCLUDED.source_type,
       access_method = EXCLUDED.access_method,
       priority = EXCLUDED.priority,
       terms_notes = EXCLUDED.terms_notes,
       last_checked_at = NOW(),
       updated_at = NOW()
     RETURNING id`,
    [SOURCE_URL],
  );
  if (!source.rows[0]) throw new Error('Operator not seeded: openserve');
  return source.rows[0].id;
}

async function ingest(client: Client, features: ArcGisFeature[], radiusM: number, projectPoints: ProjectPoint[]): Promise<IngestionSummary> {
  await client.query('BEGIN');
  try {
    const sourceId = await upsertSource(client);
    const run = await client.query<{ id: string }>(
      `INSERT INTO fno_atlas_ingestion_runs (
         source_id, run_status, records_seen, source_snapshot, created_by
       ) VALUES ($1, 'started', $2, $3::jsonb, 'fno-atlas-ingest-openserve-project-coverage')
       RETURNING id`,
      [
        sourceId,
        features.length,
        JSON.stringify({ source: 'openserve-arcgis-ftth-fsb', radiusM, projectPoints: projectPoints.length }),
      ],
    );
    const runId = run.rows[0]?.id;
    if (!runId) throw new Error('Could not create Openserve ingestion run');
    await client.query('DELETE FROM fno_atlas_coverage_areas WHERE source_id = $1', [sourceId]);
    let imported = 0;
    for (const feature of features) {
      const rings = feature.geometry?.rings || [];
      for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
        const geoJson = ringToPolygonGeoJson(rings[ringIndex]);
        if (!geoJson) continue;
        const attrs = feature.attributes;
        const objectId = String(attrs.OBJECTID || 'unknown');
        const insert = await client.query(
          `INSERT INTO fno_atlas_coverage_areas (
             operator_id, source_id, ingestion_run_id, external_id, area_name,
             rollout_status, network_type, confidence, geom, raw_properties
           )
           SELECT o.id, $1, $2, $3, $4,
             $5, 'ftth', 'high',
             ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON($6)), 3)),
             $7::jsonb
           FROM fno_atlas_operators o
           WHERE o.slug = 'openserve'
             AND NOT ST_IsEmpty(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON($6)), 3))`,
          [
            sourceId,
            runId,
            `openserve-ftth-fsb:${objectId}:${ringIndex}`,
            featureName(attrs),
            rolloutStatus(attrs),
            geoJson,
            JSON.stringify({ ...attrs, sourceUrl: SOURCE_URL, ringIndex, evidenceType: 'official Openserve ArcGIS FTTH polygon' }),
          ],
        );
        imported += insert.rowCount || 0;
      }
    }
    await client.query(
      `UPDATE fno_atlas_ingestion_runs
       SET run_status = 'success', finished_at = NOW(), records_imported = $2
       WHERE id = $1`,
      [runId, imported],
    );
    await client.query('COMMIT');
    return { project_points: projectPoints.length, records_seen: features.length, records_imported: imported, radius_m: radiusM };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main(): Promise<void> {
  loadEnv();
  const write = assertWriteAllowed();
  const radiusM = ingestionRadiusM();
  const client = new Client({ connectionString: connectionString(), ssl: false });
  await client.connect();
  try {
    const projectPoints = await loadProjectPoints(client);
    const objectIds = new Set<number>();
    for (const point of projectPoints) {
      const ids = await fetchObjectIdsForProject(point, radiusM);
      ids.forEach((id) => objectIds.add(id));
    }
    const sortedIds = [...objectIds].sort((a, b) => a - b);
    if (!write) {
      writeLine({ project_points: projectPoints.length, openserve_object_ids: sortedIds.length, radius_m: radiusM });
      writeLine(projectPoints.map((point) => ({ project: point.project_name, gps_drop_count: point.gps_drop_count })));
      return;
    }
    const features: ArcGisFeature[] = [];
    for (let index = 0; index < sortedIds.length; index += FETCH_CHUNK_SIZE) {
      features.push(...(await fetchFeatures(sortedIds.slice(index, index + FETCH_CHUNK_SIZE))));
    }
    writeLine(await ingest(client, features, radiusM, projectPoints));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

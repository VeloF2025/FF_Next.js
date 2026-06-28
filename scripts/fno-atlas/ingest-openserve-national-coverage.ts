#!/usr/bin/env tsx

import fs from 'node:fs';
import util from 'node:util';
import { Client } from 'pg';
import dotenv from 'dotenv';

type ArcGisFeature = {
  attributes: Record<string, unknown>;
  geometry?: { rings?: number[][][] };
};

type ArcGisQueryResponse = {
  objectIds?: number[];
  features?: ArcGisFeature[];
  error?: { message?: string; details?: string[] };
};

type InsertRow = {
  externalId: string;
  areaName: string;
  rolloutStatus: string;
  geoJson: string;
  rawProperties: string;
};

type IngestionSummary = {
  source: 'openserve-national-arcgis-ftth-fsb';
  object_ids_seen: number;
  features_seen: number;
  polygons_imported: number;
  chunk_size: number;
};

const SOURCE_URL = 'https://gis.telkom.co.za/arcgis/rest/services/isp/FTTH_SRID4148_GN1/MapServer/1';
const COVERAGE_PAGE_URL = 'https://www.openserve.co.za/coverage';
const USER_AGENT = 'FibreFlow FNO Atlas Openserve national ingestion/1.0';
const DEFAULT_CHUNK_SIZE = 250;

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

function chunkSize(): number {
  const raw = Number(process.env.FNO_ATLAS_OPENSERVE_CHUNK_SIZE || DEFAULT_CHUNK_SIZE);
  if (!Number.isInteger(raw) || raw < 1 || raw > 1000) {
    throw new Error('FNO_ATLAS_OPENSERVE_CHUNK_SIZE must be an integer between 1 and 1000');
  }
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

async function fetchAllObjectIds(): Promise<number[]> {
  const json = await fetchJson<ArcGisQueryResponse>(`${SOURCE_URL}/query`, {
    where: '1=1',
    returnIdsOnly: true,
    f: 'json',
  });
  return (json.objectIds || []).sort((a, b) => a - b);
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

function rowsFromFeatures(features: ArcGisFeature[]): InsertRow[] {
  const rows: InsertRow[] = [];
  for (const feature of features) {
    const attrs = feature.attributes;
    const objectId = String(attrs.OBJECTID || 'unknown');
    const rings = feature.geometry?.rings || [];
    for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
      const geoJson = ringToPolygonGeoJson(rings[ringIndex]);
      if (!geoJson) continue;
      rows.push({
        externalId: `openserve-ftth-fsb:${objectId}:${ringIndex}`,
        areaName: featureName(attrs),
        rolloutStatus: rolloutStatus(attrs),
        geoJson,
        rawProperties: JSON.stringify({
          ...attrs,
          sourceUrl: SOURCE_URL,
          ringIndex,
          evidenceType: 'official Openserve ArcGIS FTTH polygon',
        }),
      });
    }
  }
  return rows;
}

async function upsertSource(client: Client): Promise<string> {
  const source = await client.query<{ id: string }>(
    `INSERT INTO fno_atlas_sources (
       operator_id, source_name, source_url, source_type, access_method, priority, terms_notes, last_checked_at
     )
     SELECT id,
       'Openserve official ArcGIS FTTH FSB national layer',
       $1::text,
       'official_api',
       'api',
       7,
       'Official Openserve coverage page exposes Telkom GIS ArcGIS FTTH FSB polygons. This source is chunked national ingestion, replacing the earlier project-buffer subset.',
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

async function startRun(client: Client, sourceId: string, objectIdsSeen: number): Promise<string> {
  const run = await client.query<{ id: string }>(
    `INSERT INTO fno_atlas_ingestion_runs (
       source_id, run_status, records_seen, source_snapshot, created_by
     ) VALUES ($1, 'started', $2, $3::jsonb, 'fno-atlas-ingest-openserve-national-coverage')
     RETURNING id`,
    [sourceId, objectIdsSeen, JSON.stringify({ source: 'openserve-national-arcgis-ftth-fsb', objectIdsSeen })],
  );
  const runId = run.rows[0]?.id;
  if (!runId) throw new Error('Could not create Openserve national ingestion run');
  return runId;
}

async function insertRows(client: Client, sourceId: string, runId: string, rows: InsertRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await client.query(
    `WITH payload AS (
       SELECT * FROM UNNEST(
         $3::text[], $4::text[], $5::text[], $6::text[], $7::jsonb[]
       ) AS p(external_id, area_name, rollout_status, geojson, raw_properties)
     ), openserve AS (
       SELECT id FROM fno_atlas_operators WHERE slug = 'openserve'
     )
     INSERT INTO fno_atlas_coverage_areas (
       operator_id, source_id, ingestion_run_id, external_id, area_name,
       rollout_status, network_type, confidence, geom, raw_properties
     )
     SELECT o.id, $1, $2, p.external_id, p.area_name,
       p.rollout_status, 'ftth', 'high',
       ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(p.geojson)), 3)),
       p.raw_properties
     FROM payload p
     CROSS JOIN openserve o
     WHERE NOT ST_IsEmpty(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(p.geojson)), 3))`,
    [
      sourceId,
      runId,
      rows.map((row) => row.externalId),
      rows.map((row) => row.areaName),
      rows.map((row) => row.rolloutStatus),
      rows.map((row) => row.geoJson),
      rows.map((row) => row.rawProperties),
    ],
  );
  return result.rowCount || 0;
}

async function ingestNational(client: Client, objectIds: number[], size: number): Promise<IngestionSummary> {
  const sourceId = await upsertSource(client);
  const runId = await startRun(client, sourceId, objectIds.length);
  await client.query('DELETE FROM fno_atlas_coverage_areas WHERE source_id = $1', [sourceId]);
  let featuresSeen = 0;
  let imported = 0;
  for (let index = 0; index < objectIds.length; index += size) {
    const features = await fetchFeatures(objectIds.slice(index, index + size));
    const rows = rowsFromFeatures(features);
    featuresSeen += features.length;
    imported += await insertRows(client, sourceId, runId, rows);
    await client.query('UPDATE fno_atlas_ingestion_runs SET records_seen = $2, records_imported = $3 WHERE id = $1', [
      runId,
      featuresSeen,
      imported,
    ]);
    if (index === 0 || (index / size) % 20 === 0) writeLine(`openserve national progress ${featuresSeen}/${objectIds.length}, imported=${imported}`);
  }
  await client.query(
    `UPDATE fno_atlas_ingestion_runs
     SET run_status = 'success', finished_at = NOW(), records_seen = $2, records_imported = $3
     WHERE id = $1`,
    [runId, featuresSeen, imported],
  );
  return { source: 'openserve-national-arcgis-ftth-fsb', object_ids_seen: objectIds.length, features_seen: featuresSeen, polygons_imported: imported, chunk_size: size };
}

async function main(): Promise<void> {
  loadEnv();
  const write = assertWriteAllowed();
  const size = chunkSize();
  const objectIds = await fetchAllObjectIds();
  if (!write) {
    writeLine({ source: 'openserve-national-arcgis-ftth-fsb', object_ids_seen: objectIds.length, chunk_size: size });
    return;
  }
  const client = new Client({ connectionString: connectionString(), ssl: false });
  await client.connect();
  try {
    writeLine(await ingestNational(client, objectIds, size));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

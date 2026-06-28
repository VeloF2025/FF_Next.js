#!/usr/bin/env tsx

import fs from 'node:fs';
import util from 'node:util';
import { Client } from 'pg';
import dotenv from 'dotenv';

type GeoJsonGeometry = { type: string; coordinates: unknown };
type GeoJsonFeature = { type?: string; id?: string | number; geometry?: GeoJsonGeometry | null; properties?: Record<string, unknown> | null };
type GeoJsonCollection = { type?: string; features?: GeoJsonFeature[] };
type RouteRecord = { external_id: string; route_name: string; geojson: string; raw_properties: string };

type CountResponse = { count?: number; error?: { message?: string } };

const SOURCE_URL = 'https://agsdev.dfafrica.co.za/server/rest/services/CoverageMap/DFA_Routes/MapServer/0';
const COVERAGE_PAGE_URL = 'https://dfafrica.co.za/network/coverage/';
const WEBMAP_URL = 'https://gisportal.dfafrica.co.za/arcgis/apps/webappviewer/index.html?id=cf425ebaa2044ed08bacf33dabf2135e';
const CHUNK_SIZE = 500;

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

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: WEBMAP_URL } });
  if (!response.ok) throw new Error(`DFA routes fetch failed ${response.status}: ${url}`);
  return (await response.json()) as T;
}

async function sourceCount(): Promise<number> {
  const params = new URLSearchParams({ f: 'json', where: '1=1', returnCountOnly: 'true' });
  const payload = await fetchJson<CountResponse>(`${SOURCE_URL}/query?${params.toString()}`);
  if (!Number.isFinite(payload.count)) throw new Error(payload.error?.message || 'DFA routes count missing');
  return payload.count || 0;
}

async function fetchFeatures(): Promise<GeoJsonFeature[]> {
  const count = await sourceCount();
  const features: GeoJsonFeature[] = [];
  for (let offset = 0; offset < count; offset += CHUNK_SIZE) {
    const params = new URLSearchParams({
      f: 'geojson',
      where: '1=1',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      resultOffset: String(offset),
      resultRecordCount: String(CHUNK_SIZE),
    });
    const collection = await fetchJson<GeoJsonCollection>(`${SOURCE_URL}/query?${params.toString()}`);
    if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
      throw new Error(`DFA routes chunk at offset ${offset} did not return a FeatureCollection`);
    }
    features.push(...collection.features);
    if (collection.features.length === 0) break;
  }
  return features;
}

function stringProp(props: Record<string, unknown>, key: string): string | null {
  const value = props[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toRecord(feature: GeoJsonFeature): RouteRecord | null {
  if (feature.type !== 'Feature' || !feature.geometry) return null;
  if (feature.geometry.type !== 'LineString' && feature.geometry.type !== 'MultiLineString') return null;
  const props = feature.properties || {};
  const objectId = props.OBJECTID ?? feature.id;
  if (objectId === undefined || objectId === null) return null;
  return {
    external_id: `dfa-routes:${objectId}`,
    route_name: stringProp(props, 'Name') || stringProp(props, 'FolderPath') || `DFA route ${objectId}`,
    geojson: JSON.stringify(feature.geometry),
    raw_properties: JSON.stringify({ ...props, sourceUrl: SOURCE_URL, webMapUrl: WEBMAP_URL, coveragePageUrl: COVERAGE_PAGE_URL }),
  };
}

async function fetchRecords(): Promise<RouteRecord[]> {
  return (await fetchFeatures()).map(toRecord).filter((record): record is RouteRecord => Boolean(record));
}

async function upsertSource(client: Client): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO fno_atlas_sources (
       operator_id, source_name, source_url, source_type, access_method, priority, terms_notes, last_checked_at
     )
     SELECT id,
       'DFA public cable route ArcGIS layer',
       $1::text,
       'official_api',
       'api',
       15,
       'DFA website ArcGIS Web AppBuilder map exposes DFA_Routes polyline layer for public coverage feasibility.',
       NOW()
     FROM fno_atlas_operators
     WHERE slug = 'dfa'
     ON CONFLICT (source_url) DO UPDATE SET
       operator_id = EXCLUDED.operator_id,
       source_name = EXCLUDED.source_name,
       source_type = EXCLUDED.source_type,
       access_method = EXCLUDED.access_method,
       priority = EXCLUDED.priority,
       terms_notes = EXCLUDED.terms_notes,
       last_checked_at = NOW(),
       updated_at = NOW()
     RETURNING id`,
    [SOURCE_URL],
  );
  if (!result.rows[0]) throw new Error('Operator not seeded: dfa');
  return result.rows[0].id;
}

async function ingest(records: RouteRecord[]): Promise<Record<string, unknown>> {
  const client = new Client({ connectionString: connectionString(), ssl: false });
  await client.connect();
  try {
    await client.query('BEGIN');
    const sourceId = await upsertSource(client);
    const run = await client.query<{ id: string }>(
      `INSERT INTO fno_atlas_ingestion_runs (source_id, run_status, records_seen, source_snapshot, created_by)
       VALUES ($1, 'started', $2, $3::jsonb, 'fno-atlas-ingest-dfa-routes')
       RETURNING id`,
      [sourceId, records.length, JSON.stringify({ source: 'dfa-public-arcgis-routes', sourceUrl: SOURCE_URL, records: records.length })],
    );
    const runId = run.rows[0]?.id;
    if (!runId) throw new Error('Could not create DFA routes ingestion run');

    await client.query(`DELETE FROM fno_atlas_route_lines WHERE operator_id = (SELECT id FROM fno_atlas_operators WHERE slug = 'dfa')`);
    const inserted = await client.query(
      `WITH payload AS (
         SELECT * FROM jsonb_to_recordset($3::jsonb) AS x(
           external_id text, route_name text, geojson text, raw_properties text
         )
       )
       INSERT INTO fno_atlas_route_lines (
         operator_id, source_id, ingestion_run_id, external_id, route_name,
         route_type, network_type, confidence, geom, raw_properties
       )
       SELECT o.id, $1, $2, p.external_id, p.route_name,
         'backhaul_route', 'backhaul', 'high',
         ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(p.geojson)), 2)),
         p.raw_properties::jsonb
       FROM payload p
       CROSS JOIN fno_atlas_operators o
       WHERE o.slug = 'dfa'
         AND NOT ST_IsEmpty(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(p.geojson)), 2))`,
      [sourceId, runId, JSON.stringify(records)],
    );
    await client.query(`UPDATE fno_atlas_ingestion_runs SET run_status = 'success', finished_at = NOW(), records_imported = $2 WHERE id = $1`, [
      runId,
      inserted.rowCount || 0,
    ]);
    await client.query('COMMIT');
    return { source: 'dfa-public-arcgis-routes', routes_seen: records.length, routes_imported: inserted.rowCount || 0 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  loadEnv();
  const write = assertWriteAllowed();
  const records = await fetchRecords();
  if (!write) {
    writeLine({ source: 'dfa-public-arcgis-routes', routes_seen: records.length });
    return;
  }
  writeLine(await ingest(records));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

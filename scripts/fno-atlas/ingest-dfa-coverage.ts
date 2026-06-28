#!/usr/bin/env tsx

import fs from 'node:fs';
import util from 'node:util';
import { Client } from 'pg';
import dotenv from 'dotenv';

type GeoJsonGeometry = { type: string; coordinates: unknown };
type GeoJsonFeature = { type?: string; id?: string | number; geometry?: GeoJsonGeometry | null; properties?: Record<string, unknown> | null };
type GeoJsonCollection = { type?: string; features?: GeoJsonFeature[] };
type LayerConfig = { layerId: number; title: string; networkType: 'fttb' | 'mixed' };
type CoverageRecord = {
  external_id: string;
  area_name: string;
  rollout_status: 'live';
  network_type: 'fttb' | 'mixed';
  geojson: string;
  raw_properties: string;
};

const SOURCE_ROOT = 'https://agsdev.dfafrica.co.za/server/rest/services/CoverageMap/CoverageMapBuffer/MapServer';
const COVERAGE_PAGE_URL = 'https://dfafrica.co.za/network/coverage/';
const WEBMAP_URL = 'https://gisportal.dfafrica.co.za/arcgis/apps/webappviewer/index.html?id=cf425ebaa2044ed08bacf33dabf2135e';
const LAYERS: LayerConfig[] = [
  { layerId: 0, title: 'Broadband YES AND Other FTTB Products YES', networkType: 'mixed' },
  { layerId: 1, title: 'Broadband NO AND Other FTTB Products YES', networkType: 'fttb' },
];

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

async function fetchLayer(layer: LayerConfig): Promise<GeoJsonCollection> {
  const features: GeoJsonFeature[] = [];
  for (let offset = 0; ; offset += 20) {
    const params = new URLSearchParams({
      f: 'geojson',
      where: '1=1',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      resultOffset: String(offset),
      resultRecordCount: '20',
    });
    const url = `${SOURCE_ROOT}/${layer.layerId}/query?${params.toString()}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: WEBMAP_URL,
      },
    });
    if (!response.ok) throw new Error(`DFA layer ${layer.layerId} failed: ${response.status}`);
    const parsed = (await response.json()) as GeoJsonCollection;
    if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
      throw new Error(`DFA layer ${layer.layerId} did not return a GeoJSON FeatureCollection`);
    }
    features.push(...parsed.features);
    if (parsed.features.length < 20) break;
  }
  return { type: 'FeatureCollection', features };
}

function stringProp(props: Record<string, unknown>, key: string): string | null {
  const value = props[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toRecord(layer: LayerConfig, feature: GeoJsonFeature): CoverageRecord | null {
  if (feature.type !== 'Feature' || !feature.geometry) return null;
  if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') return null;
  const props = feature.properties || {};
  const objectId = props.OBJECTID ?? feature.id;
  if (objectId === undefined || objectId === null) return null;
  const cellName = stringProp(props, 'Cell_Name') || stringProp(props, 'Cell_Area');
  const products = stringProp(props, 'Products');
  return {
    external_id: `dfa-coverage-map-buffer-${layer.layerId}:${objectId}`,
    area_name: cellName || `${layer.title} ${objectId}`,
    rollout_status: 'live',
    network_type: layer.networkType,
    geojson: JSON.stringify(feature.geometry),
    raw_properties: JSON.stringify({
      ...props,
      layerId: layer.layerId,
      layerTitle: layer.title,
      products,
      sourceUrl: `${SOURCE_ROOT}/${layer.layerId}`,
      webMapUrl: WEBMAP_URL,
      coveragePageUrl: COVERAGE_PAGE_URL,
    }),
  };
}

async function fetchRecords(): Promise<CoverageRecord[]> {
  const records: CoverageRecord[] = [];
  for (const layer of LAYERS) {
    const collection = await fetchLayer(layer);
    for (const feature of collection.features || []) {
      const record = toRecord(layer, feature);
      if (record) records.push(record);
    }
  }
  return records;
}

async function upsertSource(client: Client): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO fno_atlas_sources (
       operator_id, source_name, source_url, source_type, access_method, priority, terms_notes, last_checked_at
     )
     SELECT id,
       'DFA public network coverage ArcGIS layers',
       $1::text,
       'official_api',
       'api',
       25,
       'DFA website embeds a public ArcGIS Web AppBuilder map that references CoverageMapBuffer feature layers.',
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
    [WEBMAP_URL],
  );
  if (!result.rows[0]) throw new Error('Operator not seeded: dfa');
  return result.rows[0].id;
}

async function ingest(records: CoverageRecord[]): Promise<Record<string, unknown>> {
  const client = new Client({ connectionString: connectionString(), ssl: false });
  await client.connect();
  try {
    await client.query('BEGIN');
    const sourceId = await upsertSource(client);
    const run = await client.query<{ id: string }>(
      `INSERT INTO fno_atlas_ingestion_runs (source_id, run_status, records_seen, source_snapshot, created_by)
       VALUES ($1, 'started', $2, $3::jsonb, 'fno-atlas-ingest-dfa-coverage')
       RETURNING id`,
      [sourceId, records.length, JSON.stringify({ source: 'dfa-public-arcgis-coverage', layers: LAYERS, records: records.length })],
    );
    const runId = run.rows[0]?.id;
    if (!runId) throw new Error('Could not create DFA ingestion run');

    await client.query(
      `DELETE FROM fno_atlas_coverage_areas
       WHERE operator_id = (SELECT id FROM fno_atlas_operators WHERE slug = 'dfa')`,
    );

    const inserted = await client.query(
      `WITH payload AS (
         SELECT * FROM jsonb_to_recordset($3::jsonb) AS x(
           external_id text, area_name text, rollout_status text, network_type text, geojson text, raw_properties text
         )
       )
       INSERT INTO fno_atlas_coverage_areas (
         operator_id, source_id, ingestion_run_id, external_id, area_name,
         rollout_status, network_type, confidence, geom, raw_properties
       )
       SELECT o.id, $1, $2, p.external_id, p.area_name,
         p.rollout_status, p.network_type, 'high',
         ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(p.geojson)), 3)),
         p.raw_properties::jsonb
       FROM payload p
       CROSS JOIN fno_atlas_operators o
       WHERE o.slug = 'dfa'
         AND NOT ST_IsEmpty(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(p.geojson)), 3))`,
      [sourceId, runId, JSON.stringify(records)],
    );

    await client.query(
      `UPDATE fno_atlas_ingestion_runs
       SET run_status = 'success', finished_at = NOW(), records_imported = $2
       WHERE id = $1`,
      [runId, inserted.rowCount || 0],
    );
    await client.query('COMMIT');
    return { source: 'dfa-public-arcgis-coverage', polygons_seen: records.length, polygons_imported: inserted.rowCount || 0 };
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
  const byType = records.reduce<Record<string, number>>((acc, record) => {
    acc[record.network_type] = (acc[record.network_type] || 0) + 1;
    return acc;
  }, {});
  if (!write) {
    writeLine({ source: 'dfa-public-arcgis-coverage', polygons_seen: records.length, byType });
    return;
  }
  writeLine({ ...(await ingest(records)), byType });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

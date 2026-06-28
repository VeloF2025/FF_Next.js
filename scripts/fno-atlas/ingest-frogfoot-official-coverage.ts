#!/usr/bin/env tsx

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import util from 'node:util';
import { Client } from 'pg';
import dotenv from 'dotenv';

type GeoJsonGeometry = { type: string; coordinates: unknown };
type GeoJsonFeature = { type?: string; geometry?: GeoJsonGeometry | null; properties?: Record<string, unknown> | null };
type GeoJsonCollection = { type?: string; features?: GeoJsonFeature[] };
type CoverageRecord = {
  external_id: string;
  area_name: string;
  rollout_status: string;
  network_type: string;
  geojson: string;
  raw_properties: string;
};

const SOURCE_URL = 'https://maps.frogfoot.net/frogfoot/rest/api/coverage/fibre/v1/layers?bb=16,-35,33,-22&includeBuildings=false&fibreTypeId=1';
const COVERAGE_PAGE_URL = 'https://maps.frogfoot.net/beta';
const BATCH_SIZE = 500;

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

function fetchOfficialGeoJson(): GeoJsonCollection {
  const body = execFileSync('curl', [
    '-k', '--tlsv1.2', '-sS', '-A', 'Mozilla/5.0',
    '-H', 'X-Requested-With: XMLHttpRequest',
    '-H', `Referer: ${COVERAGE_PAGE_URL}`,
    '--max-time', '180', '-X', 'POST', SOURCE_URL,
  ], { encoding: 'utf8', maxBuffer: 160 * 1024 * 1024 });
  const parsed = JSON.parse(body) as GeoJsonCollection;
  if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
    throw new Error('Frogfoot source did not return a GeoJSON FeatureCollection');
  }
  return parsed;
}

function normalizeStatus(status: unknown): string {
  const value = typeof status === 'string' ? status.toLowerCase() : '';
  if (value.includes('live')) return 'live';
  if (value.includes('wip')) return 'wip';
  if (value.includes('planned')) return 'planned';
  if (value.includes('limited')) return 'live';
  if (value.includes('suspend')) return 'unknown';
  return 'unknown';
}

function networkType(feature: GeoJsonFeature): string {
  const fibre = typeof feature.properties?.fibre === 'string' ? feature.properties.fibre.toLowerCase() : '';
  if (fibre.includes('ftth') && fibre.includes('fttb')) return 'mixed';
  if (fibre.includes('ftth')) return 'ftth';
  if (fibre.includes('fttb')) return 'fttb';
  return 'mixed';
}

function stableId(feature: GeoJsonFeature, index: number): string {
  const props = feature.properties || {};
  const name = typeof props.name === 'string' ? props.name : '';
  const status = typeof props.status === 'string' ? props.status : '';
  const geometry = JSON.stringify(feature.geometry);
  const hash = crypto.createHash('sha256').update(`${name}|${status}|${geometry}`).digest('hex').slice(0, 20);
  return `frogfoot-official:${index}:${hash}`;
}

function toRecord(feature: GeoJsonFeature, index: number): CoverageRecord | null {
  if (feature.type !== 'Feature' || feature.geometry?.type !== 'Polygon') return null;
  const props = feature.properties || {};
  const title = typeof props.title === 'string' ? props.title : null;
  const name = typeof props.name === 'string' ? props.name : null;
  return {
    external_id: stableId(feature, index),
    area_name: title || name || `Frogfoot coverage ${index + 1}`,
    rollout_status: normalizeStatus(props.status),
    network_type: networkType(feature),
    geojson: JSON.stringify(feature.geometry),
    raw_properties: JSON.stringify({ ...props, sourceUrl: SOURCE_URL, coveragePageUrl: COVERAGE_PAGE_URL }),
  };
}

function parseCoverage(collection: GeoJsonCollection): CoverageRecord[] {
  return (collection.features || []).map(toRecord).filter((record): record is CoverageRecord => record !== null);
}

async function upsertSource(client: Client): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO fno_atlas_sources (
       operator_id, source_name, source_url, source_type, access_method, priority, terms_notes, last_checked_at
     )
     SELECT id,
       'Frogfoot official coverage GeoJSON',
       $1::text,
       'official_api',
       'api',
       20,
       'Frogfoot public coverage map loads this GeoJSON layer endpoint from maps.frogfoot.net/beta.',
       NOW()
     FROM fno_atlas_operators
     WHERE slug = 'frogfoot'
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
  if (!result.rows[0]) throw new Error('Operator not seeded: frogfoot');
  return result.rows[0].id;
}

async function insertBatch(client: Client, sourceId: string, runId: string, records: CoverageRecord[]): Promise<number> {
  const result = await client.query(
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
     WHERE o.slug = 'frogfoot'
       AND NOT ST_IsEmpty(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(p.geojson)), 3))`,
    [sourceId, runId, JSON.stringify(records)],
  );
  return result.rowCount || 0;
}

async function ingest(records: CoverageRecord[]): Promise<Record<string, unknown>> {
  const client = new Client({ connectionString: connectionString(), ssl: false });
  await client.connect();
  try {
    await client.query('BEGIN');
    const sourceId = await upsertSource(client);
    const run = await client.query<{ id: string }>(
      `INSERT INTO fno_atlas_ingestion_runs (source_id, run_status, records_seen, source_snapshot, created_by)
       VALUES ($1, 'started', $2, $3::jsonb, 'fno-atlas-ingest-frogfoot-official-coverage')
       RETURNING id`,
      [sourceId, records.length, JSON.stringify({ source: 'frogfoot-official-geojson', polygons: records.length })],
    );
    const runId = run.rows[0]?.id;
    if (!runId) throw new Error('Could not create Frogfoot ingestion run');
    await client.query(
      `DELETE FROM fno_atlas_coverage_areas
       WHERE operator_id = (SELECT id FROM fno_atlas_operators WHERE slug = 'frogfoot')`,
    );
    let imported = 0;
    for (let index = 0; index < records.length; index += BATCH_SIZE) {
      imported += await insertBatch(client, sourceId, runId, records.slice(index, index + BATCH_SIZE));
    }
    await client.query(
      `UPDATE fno_atlas_ingestion_runs
       SET run_status = 'success', finished_at = NOW(), records_imported = $2
       WHERE id = $1`,
      [runId, imported],
    );
    await client.query('COMMIT');
    return { source: 'frogfoot-official-geojson', polygons_seen: records.length, polygons_imported: imported };
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
  const source = fetchOfficialGeoJson();
  const records = parseCoverage(source);
  const statuses = records.reduce<Record<string, number>>((acc, record) => {
    acc[record.rollout_status] = (acc[record.rollout_status] || 0) + 1;
    return acc;
  }, {});
  if (!write) {
    writeLine({ source: 'frogfoot-official-geojson', source_features: source.features?.length || 0, polygons_seen: records.length, statuses });
    return;
  }
  writeLine({ ...(await ingest(records)), statuses });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

#!/usr/bin/env tsx

import fs from 'node:fs';
import { Client } from 'pg';
import dotenv from 'dotenv';

type GeoJsonGeometry = { type: string; coordinates: unknown };
type GeoJsonFeature = {
  type: 'Feature';
  id?: string | number;
  properties?: Record<string, unknown>;
  geometry?: GeoJsonGeometry | null;
};
type FeatureCollection = { type: 'FeatureCollection'; features: GeoJsonFeature[] };

const OPERATOR_SLUG = 'vumatel';
const SOURCE_URL = 'https://vumatelgis.co.za/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=Vumatel:coverage_view&outputFormat=application/json';
const SOURCE_NAME = 'Vumatel official GeoServer coverage view';

type LayerSummary = { source: string; featureCount: number; fetchedAt: string };

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

async function fetchJson(url: string): Promise<FeatureCollection> {
  const res = await fetch(url, { headers: { 'user-agent': 'FibreFlow FNO Atlas ingestion/1.0' } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  const json = await res.json();
  if (json?.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
    throw new Error(`Unexpected GeoJSON payload for ${url}`);
  }
  return json as FeatureCollection;
}

async function fetchOfficialFeatures(): Promise<GeoJsonFeature[]> {
  const payload = await fetchJson(SOURCE_URL);
  console.log(`Fetched ${payload.features.length} Vumatel features from official GeoServer coverage_view`);
  return payload.features;
}

async function upsertSource(client: Client): Promise<string> {
  const source = await client.query<{ id: string }>(
    `INSERT INTO fno_atlas_sources (
       operator_id, source_name, source_url, source_type, access_method, priority, last_checked_at
     )
     SELECT id, $2, $3, 'official_map', 'api', 95, NOW()
     FROM fno_atlas_operators
     WHERE slug = $1
     ON CONFLICT (source_url) DO UPDATE SET
       source_name = EXCLUDED.source_name,
       operator_id = EXCLUDED.operator_id,
       source_type = EXCLUDED.source_type,
       access_method = EXCLUDED.access_method,
       priority = EXCLUDED.priority,
       last_checked_at = NOW(),
       updated_at = NOW()
     RETURNING id`,
    [OPERATOR_SLUG, SOURCE_NAME, SOURCE_URL],
  );
  if (!source.rows[0]) throw new Error('Vumatel operator is not seeded');
  return source.rows[0].id;
}

async function startRun(client: Client, sourceId: string, dryRun: boolean, summary: LayerSummary): Promise<string> {
  const run = await client.query<{ id: string }>(
    `INSERT INTO fno_atlas_ingestion_runs (
       source_id, run_status, records_seen, source_snapshot, created_by
     ) VALUES ($1, $2, $3, $4::jsonb, 'fno-atlas-ingest-vumatel-official-coverage')
     RETURNING id`,
    [sourceId, dryRun ? 'dry_run' : 'started', summary.featureCount, JSON.stringify(summary)],
  );
  return run.rows[0].id;
}

function statusFromProps(props: Record<string, unknown>): string {
  const status = String(props.status || 'live').toLowerCase();
  if (status.includes('live')) return 'live';
  if (status.includes('progress') || status.includes('build')) return 'wip';
  if (status.includes('investigat')) return 'planned';
  if (status.includes('planned')) return 'planned';
  return 'unknown';
}

function areaName(props: Record<string, unknown>, fallback: string): string {
  return String(
    props.block_aggregation_zone_fibrehood_name ||
      props.block_aggregation_zone_fibrehood_name_city_name ||
      props.name ||
      fallback,
  );
}

async function replaceFeatures(client: Client, sourceId: string, runId: string, features: GeoJsonFeature[]): Promise<number> {
  await client.query(
    `DELETE FROM fno_atlas_coverage_areas
     WHERE operator_id = (SELECT id FROM fno_atlas_operators WHERE slug = $1)`,
    [OPERATOR_SLUG],
  );

  let imported = 0;
  for (let idx = 0; idx < features.length; idx += 1) {
    const feature = features[idx];
    if (!feature.geometry || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) continue;
    const props = feature.properties || {};
    const externalId = `vumatel-official:${String(feature.id || props.code || props.fid || idx)}`;
    const name = areaName(props, `Vumatel coverage ${idx + 1}`);
    const province = props.operational_office ? String(props.operational_office) : null;
    const municipality = props.block_aggregation_zone_fibrehood_name_city_name
      ? String(props.block_aggregation_zone_fibrehood_name_city_name)
      : null;
    const suburb = props.block_aggregation_zone_fibrehood_name
      ? String(props.block_aggregation_zone_fibrehood_name)
      : null;
    const networkType = 'ftth';
    const rolloutStatus = statusFromProps(props);

    const insert = await client.query(
      `INSERT INTO fno_atlas_coverage_areas (
         operator_id, source_id, ingestion_run_id, external_id, area_name,
         province, municipality, suburb, rollout_status, network_type, confidence,
         geom, raw_properties, first_seen_at, last_seen_at
       )
       SELECT o.id, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'high',
         ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($11), 4326))), 3)),
         $12::jsonb,
         NOW(), NOW()
       FROM fno_atlas_operators o
       WHERE o.slug = $1
         AND NOT ST_IsEmpty(ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($11), 4326))), 3))`,
      [
        OPERATOR_SLUG,
        sourceId,
        runId,
        externalId,
        name,
        province,
        municipality,
        suburb,
        rolloutStatus,
        networkType,
        JSON.stringify(feature.geometry),
        JSON.stringify({ ...props, sourceUrl: SOURCE_URL, sourceProvider: 'Vumatel GeoServer', sourceLayer: 'Vumatel:coverage_view' }),
      ],
    );
    imported += insert.rowCount || 0;
  }
  return imported;
}

async function main(): Promise<void> {
  loadEnv();
  const write = assertWriteAllowed();
  const features = await fetchOfficialFeatures();
  const summary = { source: 'Vumatel:coverage_view', featureCount: features.length, fetchedAt: new Date().toISOString() };
  console.log(`Vumatel official GeoServer fetched ${features.length} features`);
  if (!write) return;

  const client = new Client({ connectionString: connectionString(), ssl: false });
  await client.connect();
  try {
    await client.query('BEGIN');
    const sourceId = await upsertSource(client);
    const runId = await startRun(client, sourceId, false, summary);
    const imported = await replaceFeatures(client, sourceId, runId, features);
    await client.query(
      `UPDATE fno_atlas_ingestion_runs
       SET run_status = 'success', finished_at = NOW(), records_imported = $2
       WHERE id = $1`,
      [runId, imported],
    );
    await client.query('COMMIT');
    console.log(`Vumatel imported ${imported} official coverage polygons`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});

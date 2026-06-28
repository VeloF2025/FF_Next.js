#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import dotenv from 'dotenv';

type GeoJsonFeature = {
  type: 'Feature';
  properties?: Record<string, unknown>;
  geometry?: { type: string; coordinates: unknown } | null;
};

type GeoJsonFeatureCollection = {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
};

type AtomicLayer = {
  operatorSlug: string;
  operatorName: string;
  url: string;
  networkType: 'ftth';
};

const atomicLayers: AtomicLayer[] = [
  {
    operatorSlug: 'octotel',
    operatorName: 'Octotel',
    url: 'https://www.atomic.co.za/wp-content/uploads/2026/01/octotel-coverage-2026-01-07.geojson',
    networkType: 'ftth',
  },
  {
    operatorSlug: 'frogfoot',
    operatorName: 'Frogfoot',
    url: 'https://www.atomic.co.za/wp-content/uploads/2026/01/frogfoot-coverage-2026-01-07.geojson',
    networkType: 'ftth',
  },
  {
    operatorSlug: 'vumatel',
    operatorName: 'Vumatel',
    url: 'https://www.atomic.co.za/wp-content/uploads/2026/01/vumatel-coverage-2026-01-07.geojson',
    networkType: 'ftth',
  },
];

function loadEnv(): void {
  const envFile = process.env.FF_ENV_FILE || '/home/velo/fibreflow-dev/.env.local';
  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile, quiet: true });
  }
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

async function fetchGeoJson(url: string): Promise<GeoJsonFeatureCollection> {
  const res = await fetch(url, { headers: { 'user-agent': 'FibreFlow FNO Atlas ingestion/1.0' } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  const json = await res.json();
  if (json?.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
    throw new Error(`Unexpected GeoJSON payload for ${url}`);
  }
  return json as GeoJsonFeatureCollection;
}

async function upsertSource(client: Client, layer: AtomicLayer): Promise<string> {
  const source = await client.query<{ id: string }>(
    `INSERT INTO fno_atlas_sources (
       operator_id, source_name, source_url, source_type, access_method, priority, last_checked_at
     )
     SELECT id, $2, $3, 'partner_aggregator', 'static_fetch', 25, NOW()
     FROM fno_atlas_operators
     WHERE slug = $1
     ON CONFLICT (source_url) DO UPDATE SET
       source_name = EXCLUDED.source_name,
       operator_id = EXCLUDED.operator_id,
       source_type = EXCLUDED.source_type,
       access_method = EXCLUDED.access_method,
       last_checked_at = NOW(),
       updated_at = NOW()
     RETURNING id`,
    [layer.operatorSlug, `Atomic ${layer.operatorName} GeoJSON coverage`, layer.url],
  );
  if (!source.rows[0]) throw new Error(`Operator not seeded: ${layer.operatorSlug}`);
  return source.rows[0].id;
}

async function startRun(client: Client, sourceId: string, dryRun: boolean, featureCount: number): Promise<string> {
  const run = await client.query<{ id: string }>(
    `INSERT INTO fno_atlas_ingestion_runs (
       source_id, run_status, records_seen, source_snapshot, created_by
     ) VALUES ($1, $2, $3, $4::jsonb, 'fno-atlas-ingest-atomic-coverage')
     RETURNING id`,
    [sourceId, dryRun ? 'dry_run' : 'started', featureCount, JSON.stringify({ source: 'atomic', featureCount })],
  );
  return run.rows[0].id;
}

async function insertFeatures(
  client: Client,
  layer: AtomicLayer,
  sourceId: string,
  runId: string,
  features: GeoJsonFeature[],
): Promise<number> {
  await client.query('DELETE FROM fno_atlas_coverage_areas WHERE source_id = $1', [sourceId]);
  let imported = 0;
  for (let idx = 0; idx < features.length; idx += 1) {
    const feature = features[idx];
    if (!feature.geometry || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) continue;
    const props = feature.properties || {};
    const name = String(props.Name || `${layer.operatorName} coverage`);
    await client.query(
      `INSERT INTO fno_atlas_coverage_areas (
         operator_id, source_id, ingestion_run_id, external_id, area_name,
         rollout_status, network_type, confidence, geom, raw_properties
       )
       SELECT o.id, $2, $3, $4, $5, 'live', $6, 'medium',
         ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326))), 3)),
         $8::jsonb
       FROM fno_atlas_operators o
       WHERE o.slug = $1
         AND NOT ST_IsEmpty(ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326))), 3))`,
      [
        layer.operatorSlug,
        sourceId,
        runId,
        `atomic:${layer.operatorSlug}:${idx}`,
        name,
        layer.networkType,
        JSON.stringify(feature.geometry),
        JSON.stringify({ ...props, sourceUrl: layer.url, sourceProvider: 'Atomic' }),
      ],
    );
    imported += 1;
  }
  return imported;
}

async function main(): Promise<void> {
  loadEnv();
  const write = assertWriteAllowed();
  const client = new Client({ connectionString: connectionString(), ssl: false });
  await client.connect();
  try {
    for (const layer of atomicLayers) {
      const geojson = await fetchGeoJson(layer.url);
      const featureCount = geojson.features.length;
      console.log(`${layer.operatorSlug}: fetched ${featureCount} features from ${path.basename(layer.url)}`);
      if (!write) continue;
      await client.query('BEGIN');
      try {
        const sourceId = await upsertSource(client, layer);
        const runId = await startRun(client, sourceId, false, featureCount);
        const imported = await insertFeatures(client, layer, sourceId, runId, geojson.features);
        await client.query(
          `UPDATE fno_atlas_ingestion_runs
           SET run_status = 'success', finished_at = NOW(), records_imported = $2
           WHERE id = $1`,
          [runId, imported],
        );
        await client.query('COMMIT');
        console.log(`${layer.operatorSlug}: imported ${imported} coverage polygons`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

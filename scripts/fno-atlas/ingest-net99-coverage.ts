#!/usr/bin/env tsx

import fs from 'node:fs';
import util from 'node:util';
import { Client } from 'pg';
import dotenv from 'dotenv';

type KmlFeature = {
  externalId: string;
  name: string;
  rolloutStatus: 'live' | 'wip' | 'planned' | 'unknown';
  geoJson: string;
  rawProperties: string;
};

type IngestionSummary = {
  source: 'net99-official-kml';
  polygons_seen: number;
  polygons_imported: number;
  live: number;
  wip: number;
  planned: number;
  unknown: number;
};

const SOURCE_URL = 'https://area-service.national-za.aex.systems/kml?optimiseKml=True&operatorId=195ccad5-02fc-4dc2-8589-7d85e44ffe30';
const COVERAGE_PAGE_URL = 'https://portal.netninenine.co.za/Coverage';
const USER_AGENT = 'FibreFlow FNO Atlas Net99 KML ingestion/1.0';

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

async function fetchKml(): Promise<string> {
  const response = await fetch(SOURCE_URL, {
    headers: { 'user-agent': USER_AGENT, referer: COVERAGE_PAGE_URL },
  });
  if (!response.ok) throw new Error(`Net99 KML fetch failed ${response.status}`);
  return response.text();
}

function textBetween(value: string, tag: string): string | null {
  const match = value.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match?.[1]?.trim() || null;
}

function rolloutStatus(styleUrl: string): KmlFeature['rolloutStatus'] {
  if (styleUrl.includes('normal_style')) return 'live';
  if (styleUrl.includes('construction_style')) return 'wip';
  if (styleUrl.includes('future_style')) return 'planned';
  return 'unknown';
}

function coordinatesToRing(coordinates: string): number[][] | null {
  const ring = coordinates
    .trim()
    .split(/\s+/)
    .map((point) => point.split(',').map(Number))
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map((point) => [point[0], point[1]]);
  if (ring.length < 4) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) return null;
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  return ring;
}

function parseKmlFeatures(kml: string): KmlFeature[] {
  const placemarks = kml.match(/<Placemark[\s\S]*?<\/Placemark>/gi) || [];
  return placemarks.flatMap((placemark, index) => {
    const styleUrl = textBetween(placemark, 'styleUrl') || '';
    const name = textBetween(placemark, 'name') || `Net99 coverage ${index + 1}`;
    const status = rolloutStatus(styleUrl);
    const coordinates = [...placemark.matchAll(/<coordinates[^>]*>([\s\S]*?)<\/coordinates>/gi)];
    return coordinates.flatMap((match, ringIndex) => {
      const ring = coordinatesToRing(match[1] || '');
      if (!ring) return [];
      return [{
        externalId: `net99-kml:${index}:${ringIndex}`,
        name,
        rolloutStatus: status,
        geoJson: JSON.stringify({ type: 'MultiPolygon', coordinates: [[ring]] }),
        rawProperties: JSON.stringify({ sourceUrl: SOURCE_URL, coveragePageUrl: COVERAGE_PAGE_URL, styleUrl, placemarkIndex: index, ringIndex }),
      }];
    });
  });
}

async function upsertSource(client: Client): Promise<string> {
  const source = await client.query<{ id: string }>(
    `INSERT INTO fno_atlas_sources (
       operator_id, source_name, source_url, source_type, access_method, priority, terms_notes, last_checked_at
     )
     SELECT id,
       'Net Nine Nine official coverage KML',
       $1::text,
       'official_api',
       'api',
       15,
       'Net Nine Nine coverage page loads this Automation Exchange KML feed with operatorId 195ccad5-02fc-4dc2-8589-7d85e44ffe30.',
       NOW()
     FROM fno_atlas_operators
     WHERE slug = 'net99'
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
  if (!source.rows[0]) throw new Error('Operator not seeded: net99');
  return source.rows[0].id;
}

async function ingest(client: Client, features: KmlFeature[]): Promise<IngestionSummary> {
  await client.query('BEGIN');
  try {
    const sourceId = await upsertSource(client);
    const run = await client.query<{ id: string }>(
      `INSERT INTO fno_atlas_ingestion_runs (
         source_id, run_status, records_seen, source_snapshot, created_by
       ) VALUES ($1, 'started', $2, $3::jsonb, 'fno-atlas-ingest-net99-coverage')
       RETURNING id`,
      [sourceId, features.length, JSON.stringify({ source: 'net99-official-kml', featureCount: features.length })],
    );
    const runId = run.rows[0]?.id;
    if (!runId) throw new Error('Could not create Net99 ingestion run');
    await client.query('DELETE FROM fno_atlas_coverage_areas WHERE source_id = $1', [sourceId]);
    let imported = 0;
    for (const feature of features) {
      const result = await client.query(
        `INSERT INTO fno_atlas_coverage_areas (
           operator_id, source_id, ingestion_run_id, external_id, area_name,
           rollout_status, network_type, confidence, geom, raw_properties
         )
         SELECT o.id, $1, $2, $3, $4,
           $5, 'ftth', 'high',
           ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON($6)), 3)),
           $7::jsonb
         FROM fno_atlas_operators o
         WHERE o.slug = 'net99'
           AND NOT ST_IsEmpty(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON($6)), 3))`,
        [sourceId, runId, feature.externalId, feature.name, feature.rolloutStatus, feature.geoJson, feature.rawProperties],
      );
      imported += result.rowCount || 0;
    }
    await client.query(
      `UPDATE fno_atlas_ingestion_runs
       SET run_status = 'success', finished_at = NOW(), records_imported = $2
       WHERE id = $1`,
      [runId, imported],
    );
    await client.query('COMMIT');
    const counts = features.reduce<Record<KmlFeature['rolloutStatus'], number>>((acc, feature) => {
      acc[feature.rolloutStatus] += 1;
      return acc;
    }, { live: 0, wip: 0, planned: 0, unknown: 0 });
    return { source: 'net99-official-kml', polygons_seen: features.length, polygons_imported: imported, ...counts };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main(): Promise<void> {
  loadEnv();
  const write = assertWriteAllowed();
  const features = parseKmlFeatures(await fetchKml());
  if (!write) {
    const counts = features.reduce<Record<KmlFeature['rolloutStatus'], number>>((acc, feature) => {
      acc[feature.rolloutStatus] += 1;
      return acc;
    }, { live: 0, wip: 0, planned: 0, unknown: 0 });
    writeLine({ source: 'net99-official-kml', polygons_seen: features.length, ...counts });
    return;
  }
  const client = new Client({ connectionString: connectionString(), ssl: false });
  await client.connect();
  try {
    writeLine(await ingest(client, features));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

#!/usr/bin/env tsx

import fs from 'node:fs';
import util from 'node:util';
import { Client } from 'pg';
import dotenv from 'dotenv';

type FibertimeTownship = { name: string; lat: number; lng: number };

type IngestionSummary = {
  records_seen: number;
  records_imported: number;
};

function writeLine(value: unknown): void {
  process.stdout.write(`${typeof value === 'string' ? value : util.inspect(value, { depth: 4 })}\n`);
}

const SOURCE_URL = 'https://fibertime.com/';
const USER_AGENT = 'FibreFlow FNO Atlas Fibertime presence ingestion/1.0';

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

async function fetchPage(): Promise<string> {
  const response = await fetch(SOURCE_URL, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`Fetch failed ${response.status} for ${SOURCE_URL}`);
  return response.text();
}

function extractTownships(html: string): FibertimeTownship[] {
  const block = html.match(/var\s+townships\s*=\s*\[(?<items>[\s\S]*?)\]\s*;/)?.groups?.items;
  if (!block) throw new Error('Could not find Fibertime townships marker block');
  const markerRegex = /\{\s*name:\s*"(?<name>[^"]+)"\s*,\s*lat:\s*(?<lat>-?\d+(?:\.\d+)?)\s*,\s*lng:\s*(?<lng>-?\d+(?:\.\d+)?)\s*\}/g;
  const townships: FibertimeTownship[] = [];
  for (const match of block.matchAll(markerRegex)) {
    const name = match.groups?.name;
    const lat = Number(match.groups?.lat);
    const lng = Number(match.groups?.lng);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -35 || lat > -22 || lng < 16 || lng > 33) continue;
    townships.push({ name, lat, lng });
  }
  if (townships.length === 0) throw new Error('No valid Fibertime township markers parsed');
  return townships;
}

async function upsertSource(client: Client): Promise<string> {
  const source = await client.query<{ id: string }>(
    `INSERT INTO fno_atlas_sources (
       operator_id, source_name, source_url, source_type, access_method, priority, terms_notes, last_checked_at
     )
     SELECT id,
       'Fibertime public township map markers',
       $1::text,
       'official_map',
       'static_fetch',
       15,
       'Official Fibertime page embeds township lat/lng markers. Stored as presence points, not polygon boundaries.',
       NOW()
     FROM fno_atlas_operators
     WHERE slug = 'fibertime'
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
  if (!source.rows[0]) throw new Error('Operator not seeded: fibertime');
  return source.rows[0].id;
}

async function ingest(client: Client, townships: FibertimeTownship[]): Promise<IngestionSummary> {
  await client.query('BEGIN');
  try {
    const sourceId = await upsertSource(client);
    const run = await client.query<{ id: string }>(
      `INSERT INTO fno_atlas_ingestion_runs (
         source_id, run_status, records_seen, source_snapshot, created_by
       ) VALUES ($1, 'started', $2, $3::jsonb, 'fno-atlas-ingest-fibertime-presence')
       RETURNING id`,
      [sourceId, townships.length, JSON.stringify({ source: 'fibertime', markerCount: townships.length })],
    );
    const runId = run.rows[0]?.id;
    if (!runId) throw new Error('Could not create Fibertime ingestion run');
    await client.query('DELETE FROM fno_atlas_presence_points WHERE source_id = $1', [sourceId]);
    let imported = 0;
    for (const township of townships) {
      const externalId = `fibertime:${township.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      const insert = await client.query(
        `INSERT INTO fno_atlas_presence_points (
           operator_id, source_id, ingestion_run_id, external_id, point_name,
           service_status, network_type, confidence, geom, raw_properties
         )
         SELECT o.id, $1, $2, $3, $4,
           'presence_marker', 'ftth', 'medium',
           ST_SetSRID(ST_MakePoint($5::float8, $6::float8), 4326),
           $7::jsonb
         FROM fno_atlas_operators o
         WHERE o.slug = 'fibertime'`,
        [
          sourceId,
          runId,
          externalId,
          township.name,
          township.lng,
          township.lat,
          JSON.stringify({ ...township, sourceUrl: SOURCE_URL, evidenceType: 'official embedded map marker' }),
        ],
      );
      imported += insert.rowCount || 0;
    }
    await client.query(
      `UPDATE fno_atlas_ingestion_runs
       SET run_status = 'success', finished_at = NOW(), records_imported = $2
       WHERE id = $1`,
      [runId, imported],
    );
    await client.query('COMMIT');
    return { records_seen: townships.length, records_imported: imported };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main(): Promise<void> {
  loadEnv();
  const write = assertWriteAllowed();
  const townships = extractTownships(await fetchPage());
  if (!write) {
    writeLine(townships.slice(0, 12));
    writeLine(`fibertime markers parsed=${townships.length}`);
    return;
  }
  const client = new Client({ connectionString: connectionString(), ssl: false });
  await client.connect();
  try {
    writeLine(await ingest(client, townships));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

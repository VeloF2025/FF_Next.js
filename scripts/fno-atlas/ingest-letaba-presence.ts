#!/usr/bin/env tsx

/**
 * Letaba Networks presence ingestion.
 *
 * Letaba publishes no coverage map, GeoJSON, KML, WMS or WFS layer — their site
 * is a 7-page WordPress install whose only coverage tool is a BetterPortal
 * widget that answers "is this pin covered?" one point at a time. There is no
 * footprint to download, so coverage is established by probing that public API
 * at real town coordinates.
 *
 * Provenance is split so that neither half is hand-authored:
 *   - WHERE we probe  -> GeoNames ZA populated places (CC-BY 4.0), a licensed gazetteer.
 *   - WHETHER covered -> Letaba's own coverage API answers for that exact point.
 *
 * Results are presence points (mig 428), never coverage polygons (mig 427): one
 * probe at a town centroid is evidence of presence in that town, not a boundary.
 * Towns answering "no coverage" are not stored — absence of a hit at one
 * centroid is not evidence the town is uncovered.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';
import { Client } from 'pg';
import dotenv from 'dotenv';

type Town = { geonameId: string; name: string; lat: number; lng: number; population: number; featureCode: string };
type Service = { name: string; provider: string; lowestDownload?: number; highestDownload?: number; lowestCost?: number; highestCost?: number };
type CoveredTown = Town & { services: Service[] };
type IngestionSummary = { records_seen: number; records_imported: number; towns_probed: number };

const SOURCE_URL = 'https://letaba.net/apply/';
const COVERAGE_API = 'https://iqe-services-za.betterportal.net/coverage';
const PORTAL_ORIGIN = 'https://letaba.net';
const GEONAMES_URL = 'https://download.geonames.org/export/dump/ZA.zip';
const USER_AGENT = 'FibreFlow FNO Atlas Letaba presence ingestion/1.0';

/** Vhembe + Mopani + Ehlanzeni districts: Musina (north) to Lydenburg (south). */
const FOOTPRINT = { minLat: -25.2, maxLat: -22.1, minLng: 29.5, maxLng: 31.6 };
const MIN_POPULATION = Number(process.env.LETABA_MIN_POPULATION || 2000);
/** Politeness: one probe per second against a third party's public endpoint. */
const PROBE_DELAY_MS = Number(process.env.LETABA_PROBE_DELAY_MS || 1000);

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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GeoNames ZA dump: tab-separated, no header. Columns used:
 * 0 geonameid, 1 name, 4 lat, 5 lng, 6 feature class, 7 feature code, 14 population.
 */
function fetchFootprintTowns(): Town[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'letaba-geonames-'));
  const zip = path.join(dir, 'ZA.zip');
  try {
    execFileSync('curl', ['-sS', '-L', '-A', USER_AGENT, '--max-time', '120', '-o', zip, GEONAMES_URL], { stdio: ['ignore', 'ignore', 'pipe'] });
    const raw = execFileSync('unzip', ['-p', zip, 'ZA.txt'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const towns: Town[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const c = line.split('\t');
      if (c.length < 15 || c[6] !== 'P') continue;
      const lat = Number(c[4]);
      const lng = Number(c[5]);
      const population = Number(c[14] || 0);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < FOOTPRINT.minLat || lat > FOOTPRINT.maxLat) continue;
      if (lng < FOOTPRINT.minLng || lng > FOOTPRINT.maxLng) continue;
      if (population < MIN_POPULATION) continue;
      towns.push({ geonameId: c[0], name: c[1], lat, lng, population, featureCode: c[7] });
    }
    if (towns.length === 0) throw new Error('No GeoNames towns matched the Letaba footprint — check the dump format');
    return towns.sort((a, b) => b.population - a.population);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The BetterPortal endpoint is shared across ZA tenants and resolves the tenant
 * from Origin/Referer — without them it answers 400 "App/Tenant not active".
 * These headers name which operator we are asking about; they are not auth.
 */
async function probeCoverage(town: Town): Promise<Service[]> {
  const response = await fetch(COVERAGE_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': USER_AGENT,
      origin: PORTAL_ORIGIN,
      referer: `${PORTAL_ORIGIN}/apply/`,
    },
    body: JSON.stringify({ lat: town.lat, lng: town.lng }),
  });
  if (!response.ok) throw new Error(`Coverage probe failed ${response.status} for ${town.name}`);
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error(`Coverage probe returned a non-array for ${town.name}`);
  return data as Service[];
}

async function probeAll(towns: Town[], onProgress: (done: number, hits: number) => void): Promise<CoveredTown[]> {
  const covered: CoveredTown[] = [];
  for (const [index, town] of towns.entries()) {
    const services = await probeCoverage(town);
    if (services.length > 0) covered.push({ ...town, services });
    onProgress(index + 1, covered.length);
    if (index < towns.length - 1) await sleep(PROBE_DELAY_MS);
  }
  return covered;
}

/** trufibre is Letaba's FTTH product; skyfibre/wireless are fixed-wireless. */
function deriveNetworkType(services: Service[]): string {
  const providers = new Set(services.map((s) => s.provider));
  const hasFibre = providers.has('trufibre');
  const hasWireless = providers.has('wireless') || providers.has('skyfibre');
  if (hasFibre && hasWireless) return 'mixed';
  if (hasFibre) return 'ftth';
  return 'fixed_wireless';
}

async function upsertSource(client: Client): Promise<string> {
  const source = await client.query<{ id: string }>(
    `INSERT INTO fno_atlas_sources (
       operator_id, source_name, source_url, source_type, access_method, priority, terms_notes, last_checked_at
     )
     SELECT id,
       'Letaba Networks public coverage-check API (BetterPortal)',
       $1::text,
       'official_api',
       'api',
       20,
       'Letaba publishes NO coverage map/GeoJSON/KML layer — unlike every other source here, this is their public per-address coverage-check API (BetterPortal, unauthenticated), probed at GeoNames (CC-BY) town centroids. Presence points only, never polygons: a centroid hit evidences presence in the town, not a boundary. Towns returning no services are not recorded.',
       NOW()
     FROM fno_atlas_operators
     WHERE slug = 'letaba'
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
  if (!source.rows[0]) throw new Error('Operator not seeded: letaba (apply migration 443 first)');
  return source.rows[0].id;
}

async function ingest(client: Client, covered: CoveredTown[], probed: number): Promise<IngestionSummary> {
  await client.query('BEGIN');
  try {
    const sourceId = await upsertSource(client);
    const run = await client.query<{ id: string }>(
      `INSERT INTO fno_atlas_ingestion_runs (
         source_id, run_status, records_seen, source_snapshot, created_by
       ) VALUES ($1, 'started', $2, $3::jsonb, 'fno-atlas-ingest-letaba-presence')
       RETURNING id`,
      [sourceId, covered.length, JSON.stringify({ source: 'letaba', townsProbed: probed, townsCovered: covered.length, minPopulation: MIN_POPULATION })],
    );
    const runId = run.rows[0]?.id;
    if (!runId) throw new Error('Could not create Letaba ingestion run');
    await client.query('DELETE FROM fno_atlas_presence_points WHERE source_id = $1', [sourceId]);
    let imported = 0;
    for (const town of covered) {
      const insert = await client.query(
        `INSERT INTO fno_atlas_presence_points (
           operator_id, source_id, ingestion_run_id, external_id, point_name,
           service_status, network_type, confidence, geom, raw_properties
         )
         SELECT o.id, $1, $2, $3, $4,
           'live', $5, 'medium',
           ST_SetSRID(ST_MakePoint($6::float8, $7::float8), 4326),
           $8::jsonb
         FROM fno_atlas_operators o
         WHERE o.slug = 'letaba'`,
        [
          sourceId,
          runId,
          `letaba:geonames:${town.geonameId}`,
          town.name,
          deriveNetworkType(town.services),
          town.lng,
          town.lat,
          JSON.stringify({
            geonameId: town.geonameId,
            featureCode: town.featureCode,
            population: town.population,
            probedLat: town.lat,
            probedLng: town.lng,
            services: town.services,
            providers: [...new Set(town.services.map((s) => s.provider))],
            coordinateSource: GEONAMES_URL,
            coordinateLicense: 'GeoNames CC-BY 4.0',
            coverageSource: COVERAGE_API,
            evidenceType: 'operator coverage-check API hit at gazetteer town centroid',
          }),
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
    return { records_seen: covered.length, records_imported: imported, towns_probed: probed };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main(): Promise<void> {
  loadEnv();
  const write = assertWriteAllowed();
  const towns = fetchFootprintTowns();
  writeLine(`geonames towns in footprint (pop >= ${MIN_POPULATION}): ${towns.length}`);
  writeLine(`probing ${COVERAGE_API} at ${PROBE_DELAY_MS}ms intervals (~${Math.ceil((towns.length * PROBE_DELAY_MS) / 60000)} min)`);

  const covered = await probeAll(towns, (done, hits) => {
    if (done % 20 === 0 || done === towns.length) writeLine(`  probed ${done}/${towns.length}, covered ${hits}`);
  });
  writeLine(`covered towns: ${covered.length}/${towns.length}`);

  if (!write) {
    writeLine(covered.slice(0, 12).map((t) => ({ name: t.name, lat: t.lat, lng: t.lng, pop: t.population, net: deriveNetworkType(t.services), providers: t.services.map((s) => s.provider) })));
    writeLine('dry-run: no DB writes');
    return;
  }
  const client = new Client({ connectionString: connectionString(), ssl: false });
  await client.connect();
  try {
    writeLine(await ingest(client, covered, towns.length));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

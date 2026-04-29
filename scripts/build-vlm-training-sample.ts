/**
 * VLM Training Sample Builder
 *
 * Queries dr_photo_unified_reviews for drops with ≥8 of 9 core installation
 * steps present (steps 1-9; excludes step_10_signature + dome steps 11-12).
 * Distributes up to TARGET_TOTAL across regions, capped at REGION_CAP per region,
 * then snapshots into vlm_training_dataset.
 *
 * Usage:
 *   npx tsx scripts/build-vlm-training-sample.ts [--dry-run]
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const TARGET_TOTAL = 1000;
const REGION_CAP = 350;    // max per region — 3 main regions × 350 ≈ 1050 slots
const CORE_THRESHOLD = 8;  // ≥8 of 9 core steps

const isDryRun = process.argv.includes('--dry-run');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const STEP_COLS = [
  'step_01_house_photo',
  'step_02_cable_from_pole',
  'step_03_entry_outside',
  'step_04_entry_inside',
  'step_05_wall',
  'step_06_ont_back',
  'step_07_power_meter',
  'step_08_final_installation',
  'step_09_green_lights',
] as const;

const DOME_COLS = [
  'step_11_dome_joint_open',
  'step_12_dome_joint_closed',
] as const;

const ALL_STEPS = [
  ...STEP_COLS,
  'step_10_signature',
  ...DOME_COLS,
] as const;

function coreStepCount(row: Record<string, boolean>): number {
  return STEP_COLS.filter((c) => row[c]).length;
}

function domeStepCount(row: Record<string, boolean>): number {
  return DOME_COLS.filter((c) => row[c]).length;
}

function normaliseRegion(project: string | null): string {
  if (!project) return 'Unknown';
  const p = project.trim();
  if (/lawley/i.test(p)) return 'Lawley';
  if (/mamelodi/i.test(p)) return 'Mamelodi';
  if (/mohadin/i.test(p)) return 'Mohadin';
  if (/thembisa/i.test(p)) return 'Thembisa';
  if (/etwatwa/i.test(p)) return 'Etwatwa';
  if (/tonga/i.test(p)) return 'Tonga';
  return p;
}

interface CandidateRow {
  drop_number: string;
  project: string | null;
  installer_name: string | null;
  photo_source: string | null;
  photos_metadata: unknown[];
  created_at: string;
  [key: string]: unknown;
}

interface OnemapRow {
  drop_number: string;
  latitude: string | null;
  longitude: string | null;
  location_address: string | null;
  installer_name: string | null;
  installation_date: string | null;
  site: string | null;
  created_at: string | null;
}

async function fetchCandidates(): Promise<CandidateRow[]> {
  const stepExpr = STEP_COLS.map((c) => `CASE WHEN ${c} THEN 1 ELSE 0 END`).join(' + ');

  const { rows } = await pool.query<CandidateRow>(`
    SELECT
      drop_number,
      project,
      installer_name,
      photo_source,
      photos_metadata,
      created_at,
      ${ALL_STEPS.map((c) => `${c}`).join(',\n      ')}
    FROM dr_photo_unified_reviews
    WHERE (${stepExpr}) >= $1
    ORDER BY created_at DESC
  `, [CORE_THRESHOLD]);

  return rows;
}

async function fetchOnemapMetadata(
  dropNumbers: string[]
): Promise<Map<string, OnemapRow>> {
  if (dropNumbers.length === 0) return new Map();

  const placeholders = dropNumbers.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await pool.query<OnemapRow>(`
    SELECT
      drop_number,
      latitude::text,
      longitude::text,
      location_address,
      installer_name,
      installation_date::text,
      site,
      created_at::text
    FROM onemap_properties
    WHERE drop_number IN (${placeholders})
  `, dropNumbers);

  return new Map(rows.map((r) => [r.drop_number, r]));
}

function selectSample(candidates: CandidateRow[]): CandidateRow[] {
  // Group by region, apply cap, then round-robin until TARGET_TOTAL
  const byRegion = new Map<string, CandidateRow[]>();

  for (const row of candidates) {
    const region = normaliseRegion(row.project as string | null);
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region)!.push(row);
  }

  // Apply per-region cap
  const capped = new Map<string, CandidateRow[]>();
  for (const [region, rows] of byRegion) {
    capped.set(region, rows.slice(0, REGION_CAP));
  }

  // Round-robin across regions until TARGET_TOTAL
  const selected: CandidateRow[] = [];
  const regions = [...capped.keys()];
  const pointers = new Map<string, number>(regions.map((r) => [r, 0]));

  outer: while (selected.length < TARGET_TOTAL) {
    let added = false;
    for (const region of regions) {
      if (selected.length >= TARGET_TOTAL) break outer;
      const pool = capped.get(region)!;
      const ptr = pointers.get(region)!;
      if (ptr < pool.length) {
        selected.push(pool[ptr]);
        pointers.set(region, ptr + 1);
        added = true;
      }
    }
    if (!added) break; // all regions exhausted
  }

  return selected;
}

async function main() {
  process.stdout.write(`[vlm-sample] ${isDryRun ? 'DRY RUN — ' : ''}Building VLM training sample\n`);

  const candidates = await fetchCandidates();
  process.stdout.write(`[vlm-sample] Found ${candidates.length} candidates at ≥${CORE_THRESHOLD}/9 core steps\n`);

  // Print distribution
  const regionCounts = new Map<string, number>();
  for (const row of candidates) {
    const r = normaliseRegion(row.project as string | null);
    regionCounts.set(r, (regionCounts.get(r) ?? 0) + 1);
  }
  process.stdout.write('[vlm-sample] Candidate distribution:\n');
  for (const [region, count] of [...regionCounts.entries()].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${region.padEnd(20)} ${count}\n`);
  }

  const selected = selectSample(candidates);
  process.stdout.write(`[vlm-sample] Selected ${selected.length} drops for dataset\n`);

  // Print selected distribution
  const selectedRegionCounts = new Map<string, number>();
  for (const row of selected) {
    const r = normaliseRegion(row.project as string | null);
    selectedRegionCounts.set(r, (selectedRegionCounts.get(r) ?? 0) + 1);
  }
  process.stdout.write('[vlm-sample] Selected distribution:\n');
  for (const [region, count] of [...selectedRegionCounts.entries()].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${region.padEnd(20)} ${count}\n`);
  }

  if (isDryRun) {
    process.stdout.write('[vlm-sample] Dry run complete — no rows inserted\n');
    await pool.end();
    return;
  }

  // Fetch onemap metadata for lat/lng/address
  const dropNumbers = selected.map((r) => r.drop_number);
  const onemapMeta = await fetchOnemapMetadata(dropNumbers);
  process.stdout.write(`[vlm-sample] Fetched onemap metadata for ${onemapMeta.size} drops\n`);

  // Run migration first (idempotent CREATE TABLE IF NOT EXISTS)
  const { readFileSync } = await import('fs');
  const migrationSql = readFileSync(
    path.resolve(__dirname, 'migrations/sql/333_vlm_training_dataset.sql'),
    'utf-8'
  );
  await pool.query(migrationSql);
  process.stdout.write('[vlm-sample] Migration applied\n');

  // Insert rows
  let inserted = 0;
  let skipped = 0;

  for (const row of selected) {
    const region = normaliseRegion(row.project as string | null);
    const om = onemapMeta.get(row.drop_number);

    const stepsPresent: Record<string, boolean> = {};
    for (const col of ALL_STEPS) {
      stepsPresent[col] = Boolean(row[col as keyof typeof row]);
    }

    const photosMetadata = Array.isArray(row.photos_metadata) ? row.photos_metadata : [];
    const coreSteps = coreStepCount(row as unknown as Record<string, boolean>);
    const domeSteps = domeStepCount(row as unknown as Record<string, boolean>);

    const installerName = (om?.installer_name ?? row.installer_name ?? null) as string | null;
    const installDate = om?.installation_date
      ? om.installation_date.substring(0, 10)
      : null;
    const lat = om?.latitude ? parseFloat(om.latitude) : null;
    const lng = om?.longitude ? parseFloat(om.longitude) : null;

    try {
      await pool.query(`
        INSERT INTO vlm_training_dataset (
          drop_number, project_name, region, installer_name,
          installation_date, latitude, longitude, location_address,
          core_steps_present, dome_steps_present, steps_present, photos_metadata,
          source, source_imported_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (drop_number) DO NOTHING
      `, [
        row.drop_number,
        row.project as string | null ?? null,
        region,
        installerName,
        installDate,
        lat,
        lng,
        om?.location_address ?? null,
        coreSteps,
        domeSteps,
        JSON.stringify(stepsPresent),
        JSON.stringify(photosMetadata),
        row.photo_source ?? 'unknown',
        om?.created_at ?? null,
      ]);
      inserted++;
    } catch {
      skipped++;
    }
  }

  process.stdout.write(`[vlm-sample] Inserted ${inserted}, skipped (conflict) ${skipped}\n`);

  // Final verification
  const { rows: countRows } = await pool.query<{ cnt: string }>(
    'SELECT COUNT(*) as cnt FROM vlm_training_dataset'
  );
  process.stdout.write(`[vlm-sample] Total rows in vlm_training_dataset: ${countRows[0].cnt}\n`);

  const { rows: distRows } = await pool.query<{ region: string; cnt: string }>(
    'SELECT region, COUNT(*) as cnt FROM vlm_training_dataset GROUP BY region ORDER BY cnt DESC'
  );
  process.stdout.write('[vlm-sample] Final distribution:\n');
  for (const r of distRows) {
    process.stdout.write(`  ${r.region.padEnd(20)} ${r.cnt}\n`);
  }

  await pool.end();
  process.stdout.write('[vlm-sample] Done\n');
}

main().catch((err) => {
  process.stderr.write(`[vlm-sample] Fatal: ${err}\n`);
  process.exit(1);
});

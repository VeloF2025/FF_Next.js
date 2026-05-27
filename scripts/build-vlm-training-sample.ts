/**
 * VLM Training Sample Builder — Fibertime National Sample
 *
 * Sources DRs directly from 1MAP API for NON-VF Fibertime sites only.
 * Queries DRs with status "Home Installation: Installed" and ≥CORE_THRESHOLD
 * core photo steps present across all non-VF sites.
 *
 * Photo steps mapped from 1MAP photo fields (max 8 available, step_06_ont_back absent):
 *   step_01 (house/sign):      ph_sign1 | ph_prop | ph_sign2
 *   step_02 (cable/drop):      ph_cbl_r | ph_drop
 *   step_03 (entry outside):   ph_hm_ln | ph_outs
 *   step_04 (entry inside):    ph_hm_en
 *   step_05 (wall):            ph_wall
 *   step_07 (power meter):     ph_powm1 | ph_powm2
 *   step_08 (label):           ph_bl
 *   step_09/10 (after/final):  ph_after | ph_conn1
 *
 * Usage:
 *   npx tsx scripts/build-vlm-training-sample.ts [--dry-run]
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
// Fall back to main workspace .env if worktree doesn't have one
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(__dirname, '../../FF_Next.js/.env.local') });
}

const DATABASE_URL = process.env.DATABASE_URL!;
const TARGET_TOTAL = 1000;
const REGION_CAP = 350;
const CORE_THRESHOLD = 6;   // out of 8 available steps (step_06_ont_back absent in 1MAP)
const MAX_SCAN_PER_SITE = 5000; // stop scanning after this many records per site

if (!process.env.ONEMAP_EMAIL || !process.env.ONEMAP_PASSWORD) {
  process.stderr.write('[vlm-sample] Fatal: ONEMAP_EMAIL and ONEMAP_PASSWORD must be set in environment\n');
  process.exit(1);
}
const ONEMAP_1MAP_EMAIL = process.env.ONEMAP_EMAIL;
const ONEMAP_1MAP_PASSWORD = process.env.ONEMAP_PASSWORD;
const ONE_MAP_BASE = 'https://www.1map.co.za/api/v1';
const LAYER_ID = '5121';
const LOCAL_PHOTO_BASE = 'http://100.96.203.105:8003/api/photo';

const isDryRun = process.argv.includes('--dry-run');
const pool = new Pool({ connectionString: DATABASE_URL });

// Non-VF Fibertime sites — LAW (Lawley) excluded (VF's own project);
// MOA (Moakeng/Ikageng) excluded — maps to VF's Mohadin project in drops table
const NON_VF_SITES: Record<string, string> = {
  KWN: 'KwaNobuhle',
  KWM: 'KwaMashu',
  KWA: 'Kwazakhele',
  NTU: 'Ntuzuma',
  INA: 'Inanda',
  ALE: 'Alexandra',
  GRH: 'Grahamstown/Rini',
  ORA: 'Orange Farm',
  ZAM: 'Zamdela',
  LAN: 'Langaville',
  NYA: 'Nyanga/Guguletu',
  OLI: 'Olievenhoutbos',
  WEL: 'Wells Estate',
};

// Photo field → step name mapping
const PHOTO_TO_STEP: Array<{ step: string; fields: string[] }> = [
  { step: 'step_01_house_photo',       fields: ['ph_sign1', 'ph_prop', 'ph_sign2'] },
  { step: 'step_02_cable_from_pole',   fields: ['ph_cbl_r', 'ph_drop'] },
  { step: 'step_03_entry_outside',     fields: ['ph_hm_ln', 'ph_outs'] },
  { step: 'step_04_entry_inside',      fields: ['ph_hm_en'] },
  { step: 'step_05_wall',              fields: ['ph_wall'] },
  // step_06_ont_back not present in 1MAP layer 5121
  { step: 'step_07_power_meter',       fields: ['ph_powm1', 'ph_powm2'] },
  { step: 'step_08_final_installation',fields: ['ph_bl'] },
  { step: 'step_09_green_lights',      fields: ['ph_after', 'ph_conn1'] },
];

// All photo fields we care about (excludes ph_ont which is ONT serial text, not a photo)
const ALL_PHOTO_FIELDS = [
  'ph_prop', 'ph_sign1', 'ph_sign2', 'ph_sign3',
  'ph_cbl_r', 'ph_drop',
  'ph_hm_ln', 'ph_outs',
  'ph_hm_en',
  'ph_wall',
  'ph_powm1', 'ph_powm2',
  'ph_bl',
  'ph_after', 'ph_conn1',
  'ph_hh1', 'ph_hh2',
];

interface OneMapFeature {
  id: string;
  geometry: { coordinates: number[] };
  properties: Record<string, string | number | null>;
}

interface SiteCandidate {
  drNumber: string;
  propId: string;
  site: string;
  siteName: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  installer: string | null;
  installDate: string | null;
  coreSteps: number;
  stepsPresent: Record<string, boolean>;
  photosMetadata: Array<{ step: string | null; field: string; filename: string; url: string; attachmentId: number }>;
}

let _token: string | null = null;

async function authenticate(): Promise<string> {
  if (_token) return _token;
  const url = `${ONE_MAP_BASE}/auth/login?email=${encodeURIComponent(ONEMAP_1MAP_EMAIL)}&password=${encodeURIComponent(ONEMAP_1MAP_PASSWORD)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`1MAP auth failed: ${resp.status}`);
  const data = await resp.json() as { apiToken: { token: string } };
  _token = data.apiToken.token;
  return _token;
}

async function fetchOnePage(site: string, page: number): Promise<{
  features: OneMapFeature[];
  totalResults: number;
  totalPages: number;
}> {
  const token = await authenticate();
  const cql = encodeURIComponent(`site='${site}' AND status='Home Installation: Installed'`);
  const start = (page - 1) * 50;
  const url = `${ONE_MAP_BASE}/attributes/${LAYER_ID}/unsorted?includeData=true&CQL_FILTER=${cql}&token=${token}&limit=50&start=${start}`;

  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`1MAP query failed: ${resp.status}`);
  const data = await resp.json() as {
    resultInfo: { totalResults: number; totalPages: number };
    result: { geomResult: { features: OneMapFeature[] } };
  };

  return {
    features: data.result?.geomResult?.features ?? [],
    totalResults: data.resultInfo?.totalResults ?? 0,
    totalPages: data.resultInfo?.totalPages ?? 1,
  };
}

function parseFeature(feature: OneMapFeature, siteCode: string, siteName: string): SiteCandidate | null {
  const props = feature.properties;
  const featureId = feature.id ?? '';
  const propId = featureId.includes('.') ? featureId.split('.').pop()! : featureId;
  const drNumber = String(props.drp ?? '');

  if (!drNumber || !drNumber.startsWith('DR')) return null;

  // Build steps_present
  const stepsPresent: Record<string, boolean> = {};
  for (const { step, fields } of PHOTO_TO_STEP) {
    stepsPresent[step] = fields.some((f) => {
      const v = props[f];
      return v != null && v !== '' && v !== 0 && v !== '0';
    });
  }
  stepsPresent['step_06_ont_back'] = false; // not in 1MAP layer 5121

  const coreSteps = Object.values(stepsPresent).filter(Boolean).length;
  if (coreSteps < CORE_THRESHOLD) return null;

  // Build photos metadata
  const photosMetadata: SiteCandidate['photosMetadata'] = [];
  const usedAttachments = new Set<number>();

  for (const { step, fields } of PHOTO_TO_STEP) {
    for (const field of fields) {
      const v = props[field];
      if (v == null || v === '' || v === 0 || v === '0') continue;
      const attachmentId = Number(v);
      if (isNaN(attachmentId) || usedAttachments.has(attachmentId)) continue;
      usedAttachments.add(attachmentId);
      const filename = `${field}_${attachmentId}.jpg`;
      photosMetadata.push({
        step,
        field,
        filename,
        url: `${LOCAL_PHOTO_BASE}/${drNumber}/${filename}`,
        attachmentId,
      });
      break; // only use first matching field per step
    }
  }

  // Also add extra photos not in core steps
  for (const field of ALL_PHOTO_FIELDS) {
    const v = props[field];
    if (v == null || v === '' || v === 0 || v === '0') continue;
    const attachmentId = Number(v);
    if (isNaN(attachmentId) || usedAttachments.has(attachmentId)) continue;
    usedAttachments.add(attachmentId);
    const filename = `${field}_${attachmentId}.jpg`;
    photosMetadata.push({
      step: null,
      field,
      filename,
      url: `${LOCAL_PHOTO_BASE}/${drNumber}/${filename}`,
      attachmentId,
    });
  }

  const coords = feature.geometry?.coordinates;
  const lat = coords && coords[1] != null ? Number(coords[1]) : null;
  const lng = coords && coords[0] != null ? Number(coords[0]) : null;

  const installDate = props.installation_date
    ? String(props.installation_date).substring(0, 10)
    : props.date_status_changed
      ? String(props.date_status_changed).substring(0, 10)
      : null;

  return {
    drNumber,
    propId,
    site: siteCode,
    siteName,
    address: String(props.address ?? props.add_com ?? '').trim() || null,
    lat: lat !== null && !isNaN(lat) ? lat : null,
    lng: lng !== null && !isNaN(lng) ? lng : null,
    installer: String(props.last_modified_install_by ?? '').replace('@fibertime.com', '') || null,
    installDate,
    coreSteps,
    stepsPresent,
    photosMetadata,
  };
}

async function collectCandidatesForSite(siteCode: string, siteName: string): Promise<SiteCandidate[]> {
  // Each DR has multiple Property IDs in 1MAP (one per stage visit), all sharing
  // the current DR status. Deduplicate by DR number, keeping the record with most photos.
  const byDr = new Map<string, SiteCandidate>();
  let page = 1;
  let totalPages = 1;
  let scanned = 0;

  while (byDr.size < REGION_CAP && scanned < MAX_SCAN_PER_SITE) {
    const { features, totalPages: tp } = await fetchOnePage(siteCode, page);
    totalPages = tp;
    scanned += features.length;

    if (features.length === 0) break;

    for (const f of features) {
      const candidate = parseFeature(f, siteCode, siteName);
      if (!candidate) continue;
      // Keep the record with highest core step count for each DR
      const existing = byDr.get(candidate.drNumber);
      if (!existing || candidate.coreSteps > existing.coreSteps) {
        byDr.set(candidate.drNumber, candidate);
      }
    }

    process.stdout.write(`\r  ${siteCode}: page ${page}/${totalPages}, scanned ${scanned}, unique ${byDr.size}/${REGION_CAP}  `);

    if (page >= totalPages) break;
    page++;
    await new Promise((r) => setTimeout(r, 150));
  }

  process.stdout.write('\n');
  return [...byDr.values()].slice(0, REGION_CAP);
}

function selectSample(bySite: Map<string, SiteCandidate[]>): SiteCandidate[] {
  const selected: SiteCandidate[] = [];
  const sites = [...bySite.keys()];
  const pointers = new Map<string, number>(sites.map((s) => [s, 0]));

  outer: while (selected.length < TARGET_TOTAL) {
    let added = false;
    for (const site of sites) {
      if (selected.length >= TARGET_TOTAL) break outer;
      const bucket = bySite.get(site)!;
      const ptr = pointers.get(site)!;
      if (ptr < bucket.length) {
        selected.push(bucket[ptr]);
        pointers.set(site, ptr + 1);
        added = true;
      }
    }
    if (!added) break;
  }
  return selected;
}

async function main() {
  process.stdout.write(`[vlm-sample] ${isDryRun ? 'DRY RUN — ' : ''}Building VLM training sample from Fibertime 1MAP API\n`);
  process.stdout.write(`[vlm-sample] Target: ${TARGET_TOTAL} DRs | Cap: ${REGION_CAP}/site | Threshold: ${CORE_THRESHOLD}/8 core steps\n\n`);

  // Auth check
  await authenticate();
  process.stdout.write('[vlm-sample] 1MAP auth OK\n\n');

  const bySite = new Map<string, SiteCandidate[]>();
  const siteEntries = Object.entries(NON_VF_SITES);

  for (const [siteCode, siteName] of siteEntries) {
    process.stdout.write(`[vlm-sample] Scanning ${siteCode} (${siteName})...\n`);
    const candidates = await collectCandidatesForSite(siteCode, siteName);
    bySite.set(siteCode, candidates);
    process.stdout.write(`  → ${candidates.length} qualifying DRs\n`);
  }

  process.stdout.write('\n[vlm-sample] Candidate distribution:\n');
  for (const [site, cands] of bySite) {
    process.stdout.write(`  ${(NON_VF_SITES[site] ?? site).padEnd(25)} ${cands.length}\n`);
  }

  const selected = selectSample(bySite);
  process.stdout.write(`\n[vlm-sample] Selected: ${selected.length} DRs\n`);

  if (isDryRun) {
    process.stdout.write('[vlm-sample] Dry run — no DB writes\n');
    await pool.end();
    return;
  }

  if (selected.length === 0) {
    process.stderr.write('[vlm-sample] No candidates selected — aborting without truncating\n');
    await pool.end();
    process.exit(1);
  }

  // Truncate existing data (all from previous VF-sourced run)
  process.stdout.write('\n[vlm-sample] Truncating vlm_training_dataset...\n');
  await pool.query('TRUNCATE TABLE vlm_training_dataset');

  // Insert
  let inserted = 0;
  let skipped = 0;

  for (const c of selected) {
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
        c.drNumber,
        c.siteName,
        c.siteName,
        c.installer,
        c.installDate,
        c.lat,
        c.lng,
        c.address,
        c.coreSteps,
        0, // no dome joint photos in 1MAP Fibertime data
        JSON.stringify(c.stepsPresent),
        JSON.stringify(c.photosMetadata),
        'fibertime_1map',
        null,
      ]);
      inserted++;
    } catch (err) {
      process.stderr.write(`[vlm-sample] Insert error for ${c.drNumber}: ${err}\n`);
      skipped++;
    }
  }

  process.stdout.write(`\n[vlm-sample] Inserted ${inserted}, skipped ${skipped}\n`);

  // Summary
  const { rows: distRows } = await pool.query<{ region: string; cnt: string }>(
    'SELECT region, COUNT(*) as cnt FROM vlm_training_dataset GROUP BY region ORDER BY cnt DESC'
  );
  process.stdout.write('[vlm-sample] Final distribution:\n');
  for (const r of distRows) {
    process.stdout.write(`  ${r.region.padEnd(25)} ${r.cnt}\n`);
  }

  const { rows: [{ cnt }] } = await pool.query<{ cnt: string }>('SELECT COUNT(*) as cnt FROM vlm_training_dataset');
  process.stdout.write(`[vlm-sample] Total rows: ${cnt}\n`);

  await pool.end();
  process.stdout.write('[vlm-sample] Done\n');
}

main().catch((err) => {
  process.stderr.write(`[vlm-sample] Fatal: ${err}\n`);
  process.exit(1);
});

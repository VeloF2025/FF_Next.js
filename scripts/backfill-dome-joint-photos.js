#!/usr/bin/env node
/**
 * Backfill Dome Joint Photos from 1Map
 *
 * Re-fetches photo records from 1Map for DRs that have photos but are missing
 * dome joint (ph_hh1/ph_hh2) data in photos_metadata. Updates photos_metadata
 * and step_11/step_12 booleans.
 *
 * Usage:
 *   node scripts/backfill-dome-joint-photos.js [--limit N] [--batch N] [--dry-run]
 *
 * Options:
 *   --limit N    Process only N DRs (default: all)
 *   --batch N    Process N DRs per batch before pausing (default: 50)
 *   --dry-run    Check 1Map but don't update DB
 */

const { neon } = require('@neondatabase/serverless');

// Configuration
const ONEMAP_API = process.env.ONEMAP_HOST || 'http://100.96.203.105:8003';
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

const sql = neon(DATABASE_URL);

// Photo type to step mapping (canonical, matches stepMapper.ts)
const PHOTO_TYPE_TO_STEP = {
  'ph_house': 1, 'ph_house1': 1, 'ph_house2': 1,
  'ph_pole': 2, 'ph_cable': 2, 'ph_cable1': 2, 'ph_cable2': 2,
  'ph_entry': 3, 'ph_entry1': 3, 'ph_entry2': 3,
  'ph_entry_in': 4, 'ph_entry3': 4, 'ph_entry4': 4,
  'ph_wall': 5, 'ph_wall1': 5, 'ph_wall2': 5,
  'ph_ont': 6, 'ph_ont1': 6, 'ph_ont2': 6, 'ph_serial': 6,
  'ph_powm': 7, 'ph_powm1': 7, 'ph_powm2': 7,
  'ph_after': 8, 'ph_final': 8,
  'ph_lights': 9, 'ph_led': 9, 'ph_bl': 9, 'ph_drop': 9,
  'ph_sign1': 10, 'ph_sign2': 10, 'ph_signature': 10,
  'ph_hh1': 11,
  'ph_hh2': 12,
};

// Parse args
const args = process.argv.slice(2);
const getArg = (name, defaultVal) => {
  const idx = args.indexOf(name);
  if (idx === -1) return defaultVal;
  return args[idx + 1] ? parseInt(args[idx + 1]) : defaultVal;
};
const hasFlag = (name) => args.includes(name);

const LIMIT = getArg('--limit', 0);
const BATCH_SIZE = getArg('--batch', 50);
const DRY_RUN = hasFlag('--dry-run');

// Stats
const stats = {
  total: 0,
  checked: 0,
  updated: 0,
  hasNewDome: 0,
  noDomeOn1Map: 0,
  errors: 0,
  alreadyHasDome: 0,
};

/**
 * Fetch record from 1Map to check for dome joint photos
 */
async function fetch1MapRecord(drNumber) {
  try {
    const response = await fetch(`${ONEMAP_API}/api/record/${drNumber}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data;
  } catch {
    return null;
  }
}

/**
 * Trigger download from 1Map if needed
 */
async function triggerDownload(drNumber) {
  try {
    const response = await fetch(`${ONEMAP_API}/api/download/${drNumber}`, {
      method: 'POST',
      signal: AbortSignal.timeout(60000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Build full photos_metadata from 1Map local_photos
 */
function buildPhotosMetadata(drNumber, localPhotos) {
  return localPhotos.map(p => ({
    filename: p.filename,
    url: `/api/activate/photo/${drNumber}/${p.filename}`,
    original_type: p.type,
    step: PHOTO_TYPE_TO_STEP[p.type] || null,
  }));
}

/**
 * Process a single DR
 */
async function processDR(drNumber) {
  // Fetch from 1Map
  let record = await fetch1MapRecord(drNumber);

  if (!record) {
    stats.errors++;
    return 'error';
  }

  // If photos not downloaded yet, trigger download
  if (record.photo_count > 0 && (!record.local_photos || record.local_photos.length < record.photo_count)) {
    await triggerDownload(drNumber);
    // Re-fetch after download
    record = await fetch1MapRecord(drNumber);
    if (!record) {
      stats.errors++;
      return 'error';
    }
  }

  const localPhotos = record.local_photos || [];
  const hasDome = localPhotos.some(p => p.type === 'ph_hh1' || p.type === 'ph_hh2');

  if (!hasDome) {
    stats.noDomeOn1Map++;
    return 'no_dome';
  }

  stats.hasNewDome++;

  const hasHH1 = localPhotos.some(p => p.type === 'ph_hh1');
  const hasHH2 = localPhotos.some(p => p.type === 'ph_hh2');

  if (DRY_RUN) {
    console.log(`  ${drNumber}: Found dome photos (hh1=${hasHH1}, hh2=${hasHH2}) [dry-run]`);
    return 'dry_run';
  }

  // Build full metadata and update
  const metadata = buildPhotosMetadata(drNumber, localPhotos);

  try {
    await sql`UPDATE dr_photo_unified_reviews
      SET photos_metadata = ${JSON.stringify(metadata)}::jsonb,
          photo_count = ${metadata.length},
          step_11_dome_joint_open = ${hasHH1},
          step_12_dome_joint_closed = ${hasHH2},
          updated_at = NOW()
      WHERE drop_number = ${drNumber}`;

    stats.updated++;
    return 'updated';
  } catch (err) {
    console.error(`  ${drNumber}: DB error - ${err.message}`);
    stats.errors++;
    return 'error';
  }
}

/**
 * Main
 */
async function main() {
  console.log('='.repeat(60));
  console.log('BACKFILL DOME JOINT PHOTOS FROM 1MAP');
  console.log('='.repeat(60));
  console.log(`1Map API: ${ONEMAP_API}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Limit: ${LIMIT || 'all'}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log('');

  // Get DRs that have photos from onemap but are missing dome joint photos
  const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
  const rows = await sql`
    SELECT drop_number
    FROM dr_photo_unified_reviews
    WHERE photo_count > 0
      AND photo_source = 'onemap'
      AND photos_metadata::text NOT LIKE '%ph_hh1%'
      AND photos_metadata::text NOT LIKE '%ph_hh2%'
    ORDER BY created_at DESC
  `;

  let drs = rows.map(r => r.drop_number);
  if (LIMIT > 0) drs = drs.slice(0, LIMIT);

  stats.total = drs.length;
  console.log(`Found ${stats.total} DRs from 1Map missing dome joint photos`);
  console.log('');

  if (stats.total === 0) {
    console.log('Nothing to process!');
    return;
  }

  const startTime = Date.now();

  for (let i = 0; i < drs.length; i++) {
    stats.checked++;

    if (stats.checked % 10 === 0 || stats.checked === 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = stats.checked > 1 ? (stats.checked / (Date.now() - startTime) * 1000).toFixed(2) : '-';
      console.log(`[${stats.checked}/${stats.total}] (${elapsed}s, ${rate}/s) dome=${stats.hasNewDome} updated=${stats.updated} none=${stats.noDomeOn1Map} err=${stats.errors}`);
    }

    await processDR(drs[i]);

    // Pause between batches
    if (stats.checked % BATCH_SIZE === 0 && stats.checked < stats.total) {
      console.log(`\n--- Batch ${stats.checked / BATCH_SIZE} complete, pausing 2s ---\n`);
      await new Promise(r => setTimeout(r, 2000));
    }

    // Small delay between requests
    await new Promise(r => setTimeout(r, 100));
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total DRs checked:      ${stats.checked}`);
  console.log(`Found dome photos:      ${stats.hasNewDome}`);
  console.log(`Updated in DB:          ${stats.updated}`);
  console.log(`No dome photos on 1Map: ${stats.noDomeOn1Map}`);
  console.log(`Errors:                 ${stats.errors}`);
  console.log(`Time:                   ${totalTime}s`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

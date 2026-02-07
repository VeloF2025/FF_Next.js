#!/usr/bin/env node
/**
 * Bulk Sync Photos from 1Map
 *
 * Downloads photos from 1Map for all DRs that have photo_count = 0
 * and updates the database with photo metadata.
 *
 * Usage:
 *   node scripts/bulk-sync-1map-photos.js [--limit N] [--batch N] [--dry-run]
 *
 * Options:
 *   --limit N    Process only N DRs (default: all)
 *   --batch N    Process N DRs per batch before pausing (default: 50)
 *   --dry-run    Check 1Map but don't download or update DB
 *   --resume     Skip DRs that already have photos_metadata
 */

const { Pool } = require('pg');

// Configuration
const ONEMAP_API = process.env.ONEMAP_HOST || 'http://100.96.203.105:8003';
const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';

// Parse args
const args = process.argv.slice(2);
const getArg = (name, defaultVal) => {
  const idx = args.indexOf(name);
  if (idx === -1) return defaultVal;
  return args[idx + 1] ? parseInt(args[idx + 1]) : defaultVal;
};
const hasFlag = (name) => args.includes(name);

const LIMIT = getArg('--limit', 0); // 0 = no limit
const BATCH_SIZE = getArg('--batch', 50);
const DRY_RUN = hasFlag('--dry-run');
const RESUME = hasFlag('--resume');

// Stats
const stats = {
  total: 0,
  checked: 0,
  hasPhotos: 0,
  downloaded: 0,
  noPhotos: 0,
  errors: 0,
  skipped: 0,
};

const pool = new Pool({ connectionString: DATABASE_URL });

/**
 * Check if DR has photos in 1Map
 */
async function check1MapPhotos(drNumber) {
  try {
    const response = await fetch(`${ONEMAP_API}/api/record/${drNumber}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { exists: false, photoCount: 0 };
    }

    const data = await response.json();
    return {
      exists: true,
      photoCount: data.photo_count || 0,
      localPhotos: data.local_photos?.length || 0,
    };
  } catch (error) {
    return { exists: false, photoCount: 0, error: error.message };
  }
}

/**
 * Download photos from 1Map
 */
async function downloadPhotos(drNumber) {
  try {
    const response = await fetch(`${ONEMAP_API}/api/download/${drNumber}`, {
      method: 'POST',
      signal: AbortSignal.timeout(60000), // 60s for downloads
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    const data = await response.json();
    return {
      success: true,
      photosDownloaded: data.photos_downloaded,
      files: data.files || [],
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get photo metadata after download
 */
async function getPhotoMetadata(drNumber) {
  try {
    const response = await fetch(`${ONEMAP_API}/api/record/${drNumber}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (!data.local_photos || data.local_photos.length === 0) return null;

    return data.local_photos.map(p => ({
      filename: p.filename,
      url: `/api/activate/photo/${drNumber}/${p.filename}`,
      original_type: p.type,
      step: null, // Will be set by VLM categorization
    }));
  } catch (error) {
    return null;
  }
}

/**
 * Update database with photo metadata and log the sync event
 */
async function updateDatabase(drNumber, photoCount, photosMetadata, previousCount = 0) {
  try {
    // Update the photo metadata
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET photo_count = $1,
           photos_metadata = $2,
           photos_fetched_at = COALESCE(photos_fetched_at, NOW()),
           updated_at = NOW()
       WHERE drop_number = $3`,
      [photoCount, JSON.stringify(photosMetadata), drNumber]
    );

    // Log the sync event to activity log (only if photos were actually synced)
    if (photoCount > 0) {
      await pool.query(
        `INSERT INTO dr_activity_log (drop_number, event_type, event_data, actor)
         VALUES ($1, 'PHOTOS_SYNCED', $2, $3)`,
        [
          drNumber,
          JSON.stringify({
            previousCount,
            newCount: photoCount,
            newPhotos: photoCount - previousCount,
            source: '1Map',
            trigger: 'bulk_sync',
          }),
          'bulk-sync-script',
        ]
      );
    }

    return true;
  } catch (error) {
    console.error(`  DB update failed for ${drNumber}:`, error.message);
    return false;
  }
}

/**
 * Process a single DR
 */
async function processDR(drNumber) {
  // Check 1Map
  const check = await check1MapPhotos(drNumber);

  if (!check.exists || check.photoCount === 0) {
    stats.noPhotos++;
    return { status: 'no_photos' };
  }

  stats.hasPhotos++;

  if (DRY_RUN) {
    console.log(`  ${drNumber}: ${check.photoCount} photos in 1Map (dry-run)`);
    return { status: 'dry_run', photoCount: check.photoCount };
  }

  // Download if not already downloaded
  if (check.localPhotos < check.photoCount) {
    const download = await downloadPhotos(drNumber);
    if (!download.success) {
      // Check if it's a data issue vs real error
      if (download.error && download.error.includes('NoneType')) {
        stats.errors++;
        // Don't spam the console for known 1Map data issues
        return { status: 'skip', error: '1Map data issue' };
      }
      stats.errors++;
      console.error(`  ${drNumber}: Download failed - ${download.error}`);
      return { status: 'error', error: download.error };
    }
    console.log(`  ${drNumber}: Downloaded ${download.photosDownloaded} photos`);
  } else {
    // Photos already downloaded, just need to update DB
    console.log(`  ${drNumber}: Already downloaded ${check.localPhotos} photos, updating DB`);
  }

  // Get metadata and update DB
  const metadata = await getPhotoMetadata(drNumber);
  if (!metadata || metadata.length === 0) {
    stats.errors++;
    return { status: 'error', error: 'No metadata after download' };
  }

  const updated = await updateDatabase(drNumber, metadata.length, metadata);
  if (updated) {
    stats.downloaded++;
    return { status: 'success', photoCount: metadata.length };
  } else {
    stats.errors++;
    return { status: 'error', error: 'DB update failed' };
  }
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(60));
  console.log('BULK SYNC PHOTOS FROM 1MAP');
  console.log('='.repeat(60));
  console.log(`1Map API: ${ONEMAP_API}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Limit: ${LIMIT || 'none'}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log(`Resume: ${RESUME}`);
  console.log('');

  // Get DRs without photos
  let query = `
    SELECT drop_number
    FROM dr_photo_unified_reviews
    WHERE (photo_count = 0 OR photo_count IS NULL)
  `;

  if (RESUME) {
    query += ` AND (photos_metadata IS NULL OR photos_metadata::text = '[]' OR photos_metadata::text = 'null')`;
  }

  query += ` ORDER BY created_at DESC`;

  if (LIMIT > 0) {
    query += ` LIMIT ${LIMIT}`;
  }

  const result = await pool.query(query);
  const drs = result.rows.map(r => r.drop_number);

  stats.total = drs.length;
  console.log(`Found ${stats.total} DRs without photos`);
  console.log('');

  if (stats.total === 0) {
    console.log('Nothing to process!');
    await pool.end();
    return;
  }

  // Process in batches
  const startTime = Date.now();

  for (let i = 0; i < drs.length; i++) {
    const dr = drs[i];
    stats.checked++;

    // Progress every 10 DRs
    if (stats.checked % 10 === 0 || stats.checked === 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (stats.checked / (Date.now() - startTime) * 1000).toFixed(2);
      console.log(`[${stats.checked}/${stats.total}] Processing... (${elapsed}s, ${rate}/s)`);
    }

    await processDR(dr);

    // Pause between batches to avoid overwhelming the API
    if (stats.checked % BATCH_SIZE === 0 && stats.checked < stats.total) {
      console.log(`\n--- Batch complete, pausing 2s ---\n`);
      await new Promise(r => setTimeout(r, 2000));
    }

    // Small delay between requests
    await new Promise(r => setTimeout(r, 100));
  }

  // Final stats
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('='.repeat(60));
  console.log('SYNC COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total DRs checked:    ${stats.checked}`);
  console.log(`With photos in 1Map:  ${stats.hasPhotos}`);
  console.log(`Downloaded/Updated:   ${stats.downloaded}`);
  console.log(`No photos in 1Map:    ${stats.noPhotos}`);
  console.log(`Errors:               ${stats.errors}`);
  console.log(`Time:                 ${totalTime}s`);
  console.log('');

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

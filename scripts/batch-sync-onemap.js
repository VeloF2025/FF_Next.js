#!/usr/bin/env node
/**
 * Batch Sync DRs with OneMap
 *
 * Fetches photos and serial numbers from OneMap for DRs that haven't been synced.
 * Run with: node scripts/batch-sync-onemap.js [--limit 50] [--days 7]
 */

const { Client } = require('pg');

const ONEMAP_HOST = process.env.ONEMAP_HOST || 'http://100.96.203.105:8003';
const DATABASE_URL = process.env.DATABASE_URL || 'process.env.DATABASE_URL';

// Parse CLI args
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const daysIdx = args.indexOf('--days');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 50;
const DAYS = daysIdx !== -1 ? parseInt(args[daysIdx + 1]) : 7;

/**
 * Map photo type to unified step number (10 steps)
 */
function mapPhotoTypeToStep(photoType) {
  const mapping = {
    // Step 1: House Photo
    'ph_prop': 1, 'ph_sign1': 1, 'ph_drop': 1, 'ph_outs': 1,
    // Step 2: Cable from Pole
    'ph_pole': 2, 'ph_cbl_r': 2,
    // Step 3: Entry Outside
    'ph_entry_out': 3, 'ph_hm_ln': 3,
    // Step 4: Entry Inside
    'ph_entry_in': 4, 'ph_hm_en': 4,
    // Step 5: Wall for Installation
    'ph_wall': 5,
    // Step 6: ONT Back After Install
    'ph_ont': 6, 'ph_ont_back': 6,
    // Step 7: Power Meter Reading
    'ph_powm': 7, 'ph_powm1': 7, 'ph_powm2': 7,
    // Step 8: Final Installation
    'ph_after': 8, 'ph_final': 8,
    // Step 9: Green Lights on ONT
    'ph_lights': 9, 'ph_led': 9,
    // Step 10: Signature
    'ph_sign2': 10, 'ph_signature': 10,
  };
  return mapping[photoType] || 0;
}

/**
 * Fetch DR data from OneMap API
 */
async function fetchFromOneMap(dropNumber) {
  try {
    // Try to get the full record
    let response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`);

    // If 404, try to download first
    if (response.status === 404 || response.status === 422) {
      console.log(`  → Record not found, triggering download...`);
      const downloadResponse = await fetch(`${ONEMAP_HOST}/api/download/${dropNumber}`, {
        method: 'POST',
      });
      if (downloadResponse.ok) {
        response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`);
      } else {
        return null;
      }
    }

    if (!response.ok) {
      return null;
    }

    let data = await response.json();
    let localPhotos = data.local_photos || [];

    // If record exists but no local photos, try downloading
    if (localPhotos.length === 0 && data.photo_count > 0) {
      console.log(`  → Record exists but no local photos, downloading...`);
      const downloadResponse = await fetch(`${ONEMAP_HOST}/api/download/${dropNumber}`, {
        method: 'POST',
      });
      if (downloadResponse.ok) {
        const retryResponse = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`);
        if (retryResponse.ok) {
          data = await retryResponse.json();
          localPhotos = data.local_photos || [];
        }
      }
    }

    // Map photos with proxy URLs
    const photos = localPhotos.map((photo) => ({
      filename: photo.filename,
      step: mapPhotoTypeToStep(photo.type),
      url: `/api/activate/photo/${dropNumber}/${photo.filename}`,
      size: photo.size,
    }));

    return {
      photos,
      photo_count: photos.length,
      ont_barcode: data.ont_barcode || null,
      ups_serial: data.ups_serial || null,
    };
  } catch (error) {
    console.error(`  ✗ Error fetching ${dropNumber}:`, error.message);
    return null;
  }
}

async function main() {
  console.log(`\n🔄 Batch Sync DRs with OneMap`);
  console.log(`   Limit: ${LIMIT} DRs, Days: ${DAYS}\n`);

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    // Get un-synced DRs
    const result = await client.query(`
      SELECT drop_number, project, photo_source
      FROM dr_photo_unified_reviews
      WHERE (photo_source IS NULL OR photo_source IN ('OES Import', 'excel_import'))
        AND created_at > NOW() - INTERVAL '${DAYS} days'
      ORDER BY created_at DESC
      LIMIT $1;
    `, [LIMIT]);

    console.log(`Found ${result.rows.length} un-synced DRs\n`);

    let synced = 0;
    let failed = 0;
    let noData = 0;

    for (const row of result.rows) {
      const { drop_number, project } = row;
      process.stdout.write(`[${synced + failed + noData + 1}/${result.rows.length}] ${drop_number} (${project})...`);

      const data = await fetchFromOneMap(drop_number);

      if (!data) {
        console.log(' ✗ No data in OneMap');
        noData++;
        continue;
      }

      if (data.photo_count === 0 && !data.ont_barcode && !data.ups_serial) {
        console.log(' ⚠ Empty record');
        noData++;
        continue;
      }

      // Update database
      await client.query(`
        UPDATE dr_photo_unified_reviews
        SET
          photo_source = 'onemap',
          photo_count = $1,
          photos_metadata = $2,
          ont_serial_scanned = COALESCE($3, ont_serial_scanned),
          ups_serial_scanned = COALESCE($4, ups_serial_scanned),
          updated_at = NOW()
        WHERE drop_number = $5;
      `, [
        data.photo_count,
        JSON.stringify(data.photos),
        data.ont_barcode,
        data.ups_serial,
        drop_number,
      ]);

      console.log(` ✓ ${data.photo_count} photos, ONT: ${data.ont_barcode ? 'yes' : 'no'}, UPS: ${data.ups_serial ? 'yes' : 'no'}`);
      synced++;

      // Small delay to avoid overwhelming OneMap
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\n✅ Sync complete!`);
    console.log(`   Synced: ${synced}`);
    console.log(`   No data: ${noData}`);
    console.log(`   Failed: ${failed}`);

  } finally {
    await client.end();
  }
}

main().catch(console.error);

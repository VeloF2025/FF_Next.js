const { neonConfig, Pool } = require('@neondatabase/serverless');
const ws = require('ws');
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require'
});

const ONEMAP_HOST = 'http://192.168.1.150:8003';

async function main() {
  console.log('Fetching last 250 DRs...');

  // Get last 250 DRs
  const result = await pool.query(`
    SELECT
      drop_number,
      photo_count,
      ont_serial_scanned,
      ups_serial_scanned,
      photo_source
    FROM dr_photo_unified_reviews
    ORDER BY created_at DESC
    LIMIT 250
  `);

  const drs = result.rows;
  console.log('Total DRs:', drs.length);

  // Find DRs needing sync
  const needsSync = drs.filter(r =>
    !r.photo_count || r.photo_count === 0 || !r.ont_serial_scanned || !r.ups_serial_scanned
  );

  console.log('Need sync (missing photos/serials):', needsSync.length);

  if (needsSync.length === 0) {
    console.log('All DRs are already synced!');
    await pool.end();
    return;
  }

  // Process in batches of 3 (slower but more reliable)
  const batchSize = 3;
  let synced = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < needsSync.length; i += batchSize) {
    const batch = needsSync.slice(i, i + batchSize);

    await Promise.all(batch.map(async (dr) => {
      try {
        const dropNumber = dr.drop_number;

        // Try to get record from OneMap
        let response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`, {
          signal: AbortSignal.timeout(30000),
        });

        // If 404, try to trigger download
        if (response.status === 404 || response.status === 422) {
          console.log(`  ${dropNumber}: Not on OneMap, triggering download...`);

          const downloadResponse = await fetch(`${ONEMAP_HOST}/api/download/${dropNumber}`, {
            method: 'POST',
            signal: AbortSignal.timeout(45000),
          });

          if (downloadResponse.ok) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`, {
              signal: AbortSignal.timeout(30000),
            });
          }
        }

        if (!response.ok) {
          console.log(`  ${dropNumber}: Not available on OneMap (${response.status})`);
          skipped++;
          return;
        }

        const data = await response.json();
        let localPhotos = data.local_photos || [];

        // If no local photos but cloud has them, download
        if (localPhotos.length === 0 && data.photo_count > 0) {
          console.log(`  ${dropNumber}: Downloading ${data.photo_count} photos from cloud...`);

          await fetch(`${ONEMAP_HOST}/api/download/${dropNumber}`, {
            method: 'POST',
            signal: AbortSignal.timeout(45000),
          });

          await new Promise(resolve => setTimeout(resolve, 3000));

          const retryResponse = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`, {
            signal: AbortSignal.timeout(30000),
          });

          if (retryResponse.ok) {
            const retryData = await retryResponse.json();
            localPhotos = retryData.local_photos || [];
          }
        }

        // Extract ONT serial from barcode
        let ontSerial = null;
        if (data.ont_barcode) {
          const match = data.ont_barcode.match(/\(S\)([^(]+)/);
          if (match) {
            ontSerial = match[1].trim();
          } else if (!data.ont_barcode.includes('(')) {
            ontSerial = data.ont_barcode.trim();
          }
        }

        const upsSerial = data.ups_serial || null;

        // Update database
        if (localPhotos.length > 0 || ontSerial || upsSerial) {
          const photos = localPhotos.map(photo => ({
            filename: photo.filename,
            url: `/api/activate/photo/${dropNumber}/${photo.filename}`,
            size: photo.size,
            modified: photo.modified,
            original_type: photo.type,
          }));

          await pool.query(`
            UPDATE dr_photo_unified_reviews
            SET
              photo_source = 'onemap',
              photo_count = $1,
              photos_metadata = $2,
              ont_serial_scanned = COALESCE($3, ont_serial_scanned),
              ups_serial_scanned = COALESCE($4, ups_serial_scanned),
              updated_at = NOW()
            WHERE drop_number = $5
          `, [photos.length, JSON.stringify(photos), ontSerial, upsSerial, dropNumber]);

          console.log(`  ${dropNumber}: Synced - ${photos.length} photos, ONT: ${ontSerial || 'N/A'}, UPS: ${upsSerial || 'N/A'}`);
          synced++;
        } else {
          console.log(`  ${dropNumber}: No data available on OneMap`);
          skipped++;
        }
      } catch (error) {
        console.log(`  ${dr.drop_number}: Error - ${error.message}`);
        failed++;
      }
    }));

    console.log(`Progress: ${Math.min(i + batchSize, needsSync.length)}/${needsSync.length}`);
  }

  console.log('\n=== SYNC COMPLETE ===');
  console.log(`Synced: ${synced}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

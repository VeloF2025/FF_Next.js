/**
 * Process unprocessed WA photos through VLM
 * Extracts ONT and UPS serials from WhatsApp submission photos
 */

import pg from 'pg';
const { Pool } = pg;
import { extractSerialsFromWaPhoto } from '../src/modules/activate/services/vlmExtractionService';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const VPS_PHOTO_BASE = 'http://72.61.197.178:8866';

async function processAllWaPhotos() {
  console.log('=== WA Photo VLM Processing ===\n');

  const client = await pool.connect();

  try {
    // Get all unprocessed WA photos
    const result = await client.query(`
      SELECT id, drop_number, original_filename, local_path, vlm_processed
      FROM wa_photos
      WHERE vlm_processed = false AND purpose = 'activation'
      ORDER BY message_timestamp DESC
    `);

    const photos = result.rows;
    console.log(`Found ${photos.length} unprocessed photos\n`);

    let successCount = 0;
    let failCount = 0;

    for (const photo of photos) {
      const urlPath = photo.local_path.replace(
        '/var/lib/docker/volumes/boss-vps_dr_photos/_data/',
        '/photos/'
      );
      const photoUrl = `${VPS_PHOTO_BASE}${urlPath}`;

      console.log(`\n=== Processing ${photo.drop_number} / ${photo.original_filename} ===`);
      console.log(`URL: ${photoUrl}`);

      try {
        const extraction = await extractSerialsFromWaPhoto(photoUrl);
        console.log(`ONT: ${extraction.ontSerial || 'not found'}`);
        console.log(`UPS: ${extraction.upsSerial || 'not found'}`);
        console.log(`Confidence: ${(extraction.confidence * 100).toFixed(0)}%`);
        console.log(`Time: ${extraction.processingTimeMs}ms`);

        // Update wa_photos table
        await client.query(`
          UPDATE wa_photos
          SET
            vlm_processed = true,
            vlm_ont_serial = $1,
            vlm_ups_serial = $2,
            vlm_confidence = $3,
            vlm_processed_at = NOW(),
            updated_at = NOW()
          WHERE id = $4
        `, [extraction.ontSerial, extraction.upsSerial, extraction.confidence, photo.id]);

        console.log('✓ Updated database');
        successCount++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`✗ Error: ${message}`);

        // Mark as processed (with error) to avoid retrying indefinitely
        await client.query(`
          UPDATE wa_photos
          SET vlm_processed = true, vlm_processed_at = NOW(), updated_at = NOW()
          WHERE id = $1
        `, [photo.id]);

        failCount++;
      }
    }

    // Print summary
    console.log('\n\n=== SUMMARY ===');
    console.log(`Total processed: ${photos.length}`);
    console.log(`Successful: ${successCount}`);
    console.log(`Failed: ${failCount}`);

    // Get overall stats
    const statsResult = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE vlm_processed) as processed,
        COUNT(DISTINCT vlm_ont_serial) FILTER (WHERE vlm_ont_serial IS NOT NULL) as unique_onts,
        COUNT(DISTINCT vlm_ups_serial) FILTER (WHERE vlm_ups_serial IS NOT NULL) as unique_ups
      FROM wa_photos WHERE purpose = 'activation'
    `);

    const stats = statsResult.rows[0];
    console.log('\n=== Database Stats ===');
    console.log(`Total WA photos: ${stats.total}`);
    console.log(`VLM processed: ${stats.processed}`);
    console.log(`Unique ONT serials: ${stats.unique_onts}`);
    console.log(`Unique UPS serials: ${stats.unique_ups}`);

  } finally {
    client.release();
    await pool.end();
  }
}

processAllWaPhotos().catch(console.error);

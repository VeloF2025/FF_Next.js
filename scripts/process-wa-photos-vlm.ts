/**
 * Process unprocessed WA photos through VLM
 * Extracts ONT and UPS serials from WhatsApp submission photos
 *
 * After the batch completes, calls /api/activate/pp-data-resolve so any
 * newly-extracted serials immediately get cross-referenced against unresolved
 * PPs (and the resolution cascades to tickets/drops/stock_serials).
 */

import pg from 'pg';
const { Pool } = pg;
import { extractSerialsFromWaPhoto } from '../src/modules/activate/services/vlmExtractionService';
import { createLogger } from '../src/lib/logger';

const log = createLogger('process-wa-photos-vlm');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const VPS_PHOTO_BASE = 'http://72.61.197.178:8866';

async function processAllWaPhotos() {
  log.info('=== WA Photo VLM Processing ===');

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
    log.info(`Found ${photos.length} unprocessed photos`);

    let successCount = 0;
    let failCount = 0;

    for (const photo of photos) {
      const urlPath = photo.local_path.replace(
        '/var/lib/docker/volumes/boss-vps_dr_photos/_data/',
        '/photos/'
      );
      const photoUrl = `${VPS_PHOTO_BASE}${urlPath}`;

      log.info(`Processing ${photo.drop_number} / ${photo.original_filename}`, { url: photoUrl });

      try {
        const extraction = await extractSerialsFromWaPhoto(photoUrl);
        log.info('Extraction result', {
          dr: photo.drop_number,
          ont: extraction.ontSerial || 'not found',
          ups: extraction.upsSerial || 'not found',
          confidence: extraction.confidence,
          ms: extraction.processingTimeMs,
        });

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

        successCount++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('VLM extraction failed', { dr: photo.drop_number, error: message });

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
    log.info('=== SUMMARY ===', { total: photos.length, successful: successCount, failed: failCount });

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
    log.info('=== Database Stats ===', {
      total_wa_photos: stats.total,
      vlm_processed: stats.processed,
      unique_ont_serials: stats.unique_onts,
      unique_ups_serials: stats.unique_ups,
    });

    // Post-batch hook: trigger the PP resolver so newly-extracted serials
    // immediately cross-reference against unresolved PPs (and the resolution
    // cascades to tickets/drops/stock_serials). Best-effort — failure is logged
    // but doesn't fail the batch.
    if (successCount > 0) {
      const resolveBase = process.env.PP_RESOLVE_URL || 'http://localhost:3000';
      const resolveSecret = process.env.CRON_SECRET;
      if (!resolveSecret) {
        log.warn('Post-VLM resolver hook skipped: CRON_SECRET not set');
      } else {
        try {
          const resp = await fetch(`${resolveBase}/api/activate/pp-data-resolve`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-cron-secret': resolveSecret,
            },
            body: JSON.stringify({ action: 'local-scan' }),
          });
          if (resp.ok) {
            const json = await resp.json();
            log.info('Post-VLM resolver completed', { result: json.data ?? json });
          } else {
            log.warn('Post-VLM resolver returned non-OK', { status: resp.status });
          }
        } catch (err) {
          log.warn('Post-VLM resolver call failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

  } finally {
    client.release();
    await pool.end();
  }
}

processAllWaPhotos().catch((err) => {
  log.error('Batch failed', { error: err instanceof Error ? err.message : String(err) });
  // Use process.exitCode to allow logger to flush before exit
  process.exitCode = 1;
});

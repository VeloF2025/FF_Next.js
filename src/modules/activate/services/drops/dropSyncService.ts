/**
 * Background synchronisation and self-healing for drop records.
 *
 * syncMissingFromQaPhotoReviews: throttled insert of any DRs in qa_photo_reviews
 *   that are missing from dr_photo_unified_reviews. Runs at most once per 5 minutes.
 *
 * processOrphanedRecordsInBackground: fire-and-forget re-fetch of photos for
 *   recently inserted drops that have photo_count = 0.
 */

import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { fetchPhotosWithRetry } from '@/modules/activate/services/photoFetchService';

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Module-level timestamp — survives across requests in the same Node.js process. */
let lastSyncTime = 0;

/**
 * Insert any DRs from qa_photo_reviews that are absent from dr_photo_unified_reviews.
 * Skipped if called within 5 minutes of the previous successful sync.
 * Returns the number of rows inserted (0 if throttled or nothing to sync).
 */
export async function syncMissingFromQaPhotoReviews(): Promise<number> {
  const now = Date.now();

  if (now - lastSyncTime < SYNC_INTERVAL_MS) {
    return 0;
  }

  try {
    const result = await pool.query(`
      INSERT INTO dr_photo_unified_reviews (
        drop_number, project, submission_count, submitted_date, sender_phone,
        created_at, updated_at, is_oes_only
      )
      SELECT
        qa.drop_number,
        qa.project,
        1,
        COALESCE(qa.whatsapp_message_date::DATE, qa.created_at::DATE),
        qa.sender_phone,
        qa.created_at,
        NOW(),
        FALSE
      FROM qa_photo_reviews qa
      WHERE qa.created_at > NOW() - INTERVAL '30 days'
        AND qa.drop_number IN (SELECT drop_number FROM drops)
        AND NOT EXISTS (
          SELECT 1 FROM dr_photo_unified_reviews u
          WHERE u.drop_number = qa.drop_number
        )
      ON CONFLICT (drop_number) DO NOTHING
      RETURNING drop_number
    `);

    if (result.rowCount && result.rowCount > 0) {
      log.info(`Auto-synced ${result.rowCount} missing DRs from qa_photo_reviews`, {
        dropNumbers: result.rows.map((r: Record<string, unknown>) => r.drop_number),
      }, 'DropsAPI');
    }

    lastSyncTime = now;
    return result.rowCount ?? 0;
  } catch (error: unknown) {
    log.error('Error auto-syncing from qa_photo_reviews', { error }, 'DropsAPI');
    return 0;
  }
}

/**
 * Fire-and-forget: re-fetch BOSS photos for up to 5 recently created drops
 * that have photo_count = 0 and no wa_message_id (orphaned records).
 * Errors are logged but never propagate to the caller.
 */
export function processOrphanedRecordsInBackground(): void {
  void (async () => {
    try {
      const result = await pool.query(`
        SELECT u.drop_number, w.project, w.sender_phone
        FROM dr_photo_unified_reviews u
        INNER JOIN wa_monitor_drops w ON w.drop_number = u.drop_number
        WHERE u.photo_count = 0
          AND (u.is_oes_only = FALSE OR u.is_oes_only IS NULL)
          AND u.wa_message_id IS NULL
          AND u.created_at > NOW() - INTERVAL '48 hours'
          AND u.drop_number IN (SELECT drop_number FROM drops)
        ORDER BY u.created_at DESC
        LIMIT 5
      `);

      if (result.rows.length === 0) return;

      log.info(`Self-healing: processing ${result.rows.length} orphaned DRs`, {
        dropNumbers: result.rows.map((r: Record<string, unknown>) => r.drop_number),
      }, 'DropsAPI');

      for (const row of result.rows) {
        try {
          const fetchResult = await fetchPhotosWithRetry(row.drop_number as string, {
            maxRetries: 2,
            initialDelayMs: 1000,
          });

          const { photos, ont_barcode, ups_serial } = fetchResult;

          if (photos.length > 0) {
            const photosMetadata = photos.map((p) => ({
              filename: p.filename,
              url: p.url,
              step: null,
              original_type: p.original_type,
            }));

            await pool.query(
              `UPDATE dr_photo_unified_reviews
               SET photo_source = 'onemap',
                   photo_count = $1,
                   photos_metadata = $2,
                   ont_serial_scanned = COALESCE($3, ont_serial_scanned),
                   ups_serial_scanned = COALESCE($4, ups_serial_scanned),
                   submitted_date = COALESCE(submitted_date, CURRENT_DATE),
                   project = COALESCE($5, project),
                   sender_phone = COALESCE($6, sender_phone),
                   updated_at = NOW()
               WHERE drop_number = $7`,
              [
                photos.length,
                JSON.stringify(photosMetadata),
                ont_barcode,
                ups_serial,
                row.project,
                row.sender_phone,
                row.drop_number,
              ]
            );

            log.info(
              `Self-healed ${String(row.drop_number)}: ${photos.length} photos, ont=${String(ont_barcode ?? 'N/A')}, ups=${String(ups_serial ?? 'N/A')}`,
              undefined,
              'DropsAPI'
            );
          } else {
            await pool.query(
              `UPDATE dr_photo_unified_reviews
               SET ont_serial_scanned = COALESCE($2, ont_serial_scanned),
                   ups_serial_scanned = COALESCE($3, ups_serial_scanned),
                   submitted_date = COALESCE(submitted_date, CURRENT_DATE),
                   project = COALESCE($4, project),
                   sender_phone = COALESCE($5, sender_phone),
                   updated_at = NOW()
               WHERE drop_number = $1`,
              [row.drop_number, ont_barcode, ups_serial, row.project, row.sender_phone]
            );

            log.warn(
              `Self-heal ${String(row.drop_number)}: 0 photos from BOSS, set metadata only`,
              undefined,
              'DropsAPI'
            );
          }
        } catch (drError: unknown) {
          log.error(`Self-heal failed for ${String(row.drop_number)}`, { error: drError }, 'DropsAPI');
        }
      }
    } catch (error: unknown) {
      log.error('Self-healing orphan detection failed', { error }, 'DropsAPI');
    }
  })();
}

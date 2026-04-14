/**
 * DR Categorization Service
 *
 * Handles the VLM photo categorization pipeline and related DB updates:
 * - Storing photo metadata after fetch
 * - Running VLM categorization via categorizationVlmService
 * - Persisting categorization results (success / all-errors / exception)
 * - Triggering serial verification (fire-and-forget)
 */

import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';

const log = createLogger('DrCategorizationService');
import {
  categorizePhotos,
} from '@/modules/activate/services/categorizationVlmService';
import { computeAndPersistVerification } from '@/modules/activate/services/serialVerificationService';
import type { PhotoInput } from '@/modules/activate/services/categorizationVlmService';

/** Photo metadata shape stored in photos_metadata column */
interface PhotoMeta {
  filename: string;
  url: string;
  step: null;
  original_type: string | null | undefined;
}

/** Result returned by runCategorizationPipeline */
export interface CategorizationResult {
  categorizationStatus: 'categorized' | 'failed' | 'skipped' | 'no_photos';
}

/**
 * Persist photo metadata and serial barcodes to the unified review record.
 * Called after successful photo fetch, before categorization.
 */
export async function persistPhotoMetadata(
  dropNumber: string,
  photos: PhotoInput[],
  ont_barcode: string | null | undefined,
  ups_serial: string | null | undefined
): Promise<void> {
  const photosMetadata: PhotoMeta[] = photos.map((p) => ({
    filename: p.filename,
    url: p.url,
    step: null,
    original_type: p.original_type,
  }));

  await pool.query(
    `UPDATE dr_photo_unified_reviews
     SET
       photo_source = 'onemap',
       photo_count = $1,
       photos_metadata = $2,
       ont_serial_scanned = COALESCE($3, ont_serial_scanned),
       ups_serial_scanned = COALESCE($4, ups_serial_scanned),
       updated_at = NOW()
     WHERE drop_number = $5`,
    [photos.length, JSON.stringify(photosMetadata), ont_barcode ?? null, ups_serial ?? null, dropNumber]
  );
}

/**
 * Update the unified record when no photos were found.
 * Still captures serials from 1Map when available.
 */
export async function persistNoPhotos(
  dropNumber: string,
  ont_barcode: string | null | undefined,
  ups_serial: string | null | undefined
): Promise<void> {
  await pool.query(
    `UPDATE dr_photo_unified_reviews
     SET photo_count = 0,
         photo_source = 'onemap',
         ont_serial_scanned = COALESCE($2, ont_serial_scanned),
         ups_serial_scanned = COALESCE($3, ups_serial_scanned),
         updated_at = NOW()
     WHERE drop_number = $1`,
    [dropNumber, ont_barcode ?? null, ups_serial ?? null]
  );
}

/**
 * Run VLM categorization and persist results.
 *
 * Returns 'categorized' on success (including partial errors),
 * 'failed' when all photos error or on exception.
 *
 * Always triggers serial verification fire-and-forget regardless of outcome.
 */
export async function runCategorizationPipeline(
  dropNumber: string,
  photos: PhotoInput[]
): Promise<CategorizationResult> {
  log.info(`Running VLM categorization for ${dropNumber}`);

  await pool.query(
    `UPDATE dr_photo_unified_reviews
     SET vlm_categorization_status = 'processing', updated_at = NOW()
     WHERE drop_number = $1`,
    [dropNumber]
  );

  try {
    const categorizations = await categorizePhotos(dropNumber, photos);

    const errorCount = categorizations.filter(
      (c) => c.vlm_predicted_step === 0 || c.vlm_predicted_category === 'Error'
    ).length;
    const allErrors = categorizations.length > 0 && errorCount === categorizations.length;

    if (allErrors) {
      log.warn(
        `All ${categorizations.length} categorizations are errors for ${dropNumber} — marking as failed`
      );
      await pool.query(
        `UPDATE dr_photo_unified_reviews
         SET
           vlm_categorization_status = 'failed',
           vlm_categorization_results = $1,
           vlm_retry_count = COALESCE(vlm_retry_count, 0) + 1,
           vlm_last_error = 'All photos returned Error/step=0 — VLM likely unavailable',
           vlm_next_retry_at = NOW() + INTERVAL '5 minutes',
           updated_at = NOW()
         WHERE drop_number = $2`,
        [JSON.stringify(categorizations), dropNumber]
      );
    } else {
      await pool.query(
        `UPDATE dr_photo_unified_reviews
         SET
           vlm_categorization_status = 'categorized',
           vlm_categorization_results = $1,
           vlm_categorized_at = NOW(),
           updated_at = NOW()
         WHERE drop_number = $2`,
        [JSON.stringify(categorizations), dropNumber]
      );
    }

    log.info(`Categorization complete for ${dropNumber}`, {
      photoCount: categorizations.length,
      errorCount,
      allErrors,
    });

    fireSerialVerification(dropNumber);

    return { categorizationStatus: allErrors ? 'failed' : 'categorized' };
  } catch (catError) {
    log.error(`Categorization failed for ${dropNumber}`, { error: catError });

    const errorMessage = catError instanceof Error ? catError.message : 'Unknown error';
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET
         vlm_categorization_status = 'failed',
         vlm_retry_count = COALESCE(vlm_retry_count, 0) + 1,
         vlm_last_error = $1,
         vlm_next_retry_at = NOW() + INTERVAL '5 minutes',
         updated_at = NOW()
       WHERE drop_number = $2`,
      [errorMessage, dropNumber]
    );

    fireSerialVerification(dropNumber);

    return { categorizationStatus: 'failed' };
  }
}

/** Fire-and-forget: compute 4-way serial verification badge */
function fireSerialVerification(dropNumber: string): void {
  computeAndPersistVerification(dropNumber).catch((err) =>
    log.error(`Serial verification failed for ${dropNumber}`, { error: err })
  );
}

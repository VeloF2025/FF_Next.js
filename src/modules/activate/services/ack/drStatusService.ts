/**
 * DR Status Service
 *
 * Handles all database write operations for DR acknowledgment:
 * - updateOneMapStatus: UPSERT onemap_status + persist serials
 * - markForRework: snapshot current state and reset QA workflow for resubmission
 * - saveSwapDetection: persist swap detection flags for tracking
 * - checkDuplicateSerials: detect serials already used on other DRs
 */

import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';

import type { DuplicateSerialHit, DuplicateSerialResult } from './types';

const logger = createLogger('activate/ack/drStatusService');

/**
 * Update onemap_status in dr_photo_unified_reviews.
 *
 * Creates record if not exists (UPSERT).
 * Also persists ONT/UPS serials when available so PP scan can match later.
 */
export async function updateOneMapStatus(
  dropNumber: string,
  status: 'found' | 'not_found' | 'resolved',
  ontSerial?: string | null,
  upsSerial?: string | null
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO dr_photo_unified_reviews (
         drop_number, onemap_status, onemap_checked_at,
         ont_serial_scanned, ups_serial_scanned,
         created_at, updated_at
       ) VALUES ($1, $2, NOW(), $3, $4, NOW(), NOW())
       ON CONFLICT (drop_number) DO UPDATE SET
         onemap_status = $2,
         onemap_checked_at = NOW(),
         ont_serial_scanned = COALESCE(EXCLUDED.ont_serial_scanned, dr_photo_unified_reviews.ont_serial_scanned),
         ups_serial_scanned = COALESCE(EXCLUDED.ups_serial_scanned, dr_photo_unified_reviews.ups_serial_scanned),
         updated_at = NOW()`,
      [dropNumber, status, ontSerial || null, upsSerial || null]
    );
    logger.info(`Set onemap_status=${status} for ${dropNumber}`, {
      ontSerial: ontSerial || null,
      upsSerial: upsSerial || null,
    });
  } catch (error) {
    logger.warn(`Failed to update onemap_status for ${dropNumber}`, { error });
  }
}

/**
 * Mark DR for rework and reset QA workflow for resubmission.
 *
 * This function:
 * 1. Snapshots current state into submission_history
 * 2. Increments submission_count
 * 3. Resets qa_phase to null (re-enter workflow from start)
 * 4. Resets feedback_sent to allow new feedback
 * 5. Sets qa_decision to null (will be set again when reviewed)
 */
export async function markForRework(dropNumber: string, newPhotoCount: number): Promise<void> {
  try {
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET
         -- Snapshot current state into submission_history array
         submission_history = COALESCE(submission_history, '[]'::jsonb) || jsonb_build_object(
           'submission_number', COALESCE(submission_count, 1),
           'snapshot_at', NOW(),
           'photo_count', photo_count,
           'qa_decision', qa_decision,
           'qa_decision_at', qa_decision_at,
           'feedback_sent', feedback_sent,
           'feedback_sent_at', feedback_sent_at,
           'feedback_message', feedback_message,
           'qa_phase', qa_phase,
           'vlm_categorization_status', vlm_categorization_status
         ),
         -- Increment submission count
         submission_count = COALESCE(submission_count, 1) + 1,
         -- Reset QA workflow state for fresh review
         qa_phase = NULL,
         qa_decision = NULL,
         qa_decision_at = NULL,
         feedback_sent = false,
         feedback_sent_at = NULL,
         -- Keep feedback_message for reference but don't require resending
         -- Reset categorization to trigger re-processing
         vlm_categorization_status = 'pending',
         -- Update photo count with new value from 1Map
         photo_count = $2,
         -- Timestamp
         updated_at = NOW()
       WHERE drop_number = $1`,
      [dropNumber, newPhotoCount]
    );
    logger.info(`Reset ${dropNumber} for QA re-review (resubmission)`, {
      newPhotoCount,
    });
  } catch (error) {
    logger.warn(`Failed to mark ${dropNumber} for rework`, { error });
  }
}

/**
 * Save swap detection to database for tracking.
 *
 * Creates/updates record in dr_photo_unified_reviews with swap status.
 * Does not overwrite an existing swap_status that was already set.
 */
export async function saveSwapDetection(
  dropNumber: string,
  ontSerial: string | null,
  upsSerial: string | null,
  swapDetails: string | null
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO dr_photo_unified_reviews (
         drop_number,
         ont_serial_scanned,
         ups_serial_scanned,
         serial_swap_detected,
         serial_swap_status,
         serial_swap_details,
         serial_swap_detected_at,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3, true, 'pending_correction', $4, NOW(), NOW(), NOW())
       ON CONFLICT (drop_number) DO UPDATE SET
         ont_serial_scanned = COALESCE(EXCLUDED.ont_serial_scanned, dr_photo_unified_reviews.ont_serial_scanned),
         ups_serial_scanned = COALESCE(EXCLUDED.ups_serial_scanned, dr_photo_unified_reviews.ups_serial_scanned),
         serial_swap_detected = true,
         serial_swap_status = CASE
           WHEN dr_photo_unified_reviews.serial_swap_status IS NULL THEN 'pending_correction'
           ELSE dr_photo_unified_reviews.serial_swap_status
         END,
         serial_swap_details = $4,
         serial_swap_detected_at = COALESCE(dr_photo_unified_reviews.serial_swap_detected_at, NOW()),
         updated_at = NOW()`,
      [dropNumber, ontSerial, upsSerial, swapDetails]
    );
    logger.info(`Saved swap detection for ${dropNumber}`, { swapDetails });
  } catch (error) {
    logger.warn(`Failed to save swap detection for ${dropNumber}`, { error });
  }
}

/**
 * Check for duplicate serials across other DRs.
 *
 * Non-critical: returns empty result on failure so ack message still sends.
 * Checks both ont_serial_scanned and oes_serial columns for ONT matches.
 */
export async function checkDuplicateSerials(
  dropNumber: string,
  ontSerial: string | null,
  upsSerial: string | null
): Promise<DuplicateSerialResult> {
  const empty: DuplicateSerialResult = { ontDuplicates: [], upsDuplicates: [] };

  try {
    const queries: Promise<DuplicateSerialHit[]>[] = [];

    // ONT duplicate check (match ont_serial_scanned OR oes_serial)
    if (ontSerial) {
      queries.push(
        pool.query(
          `SELECT drop_number, 'ont' as type FROM dr_photo_unified_reviews
           WHERE UPPER(ont_serial_scanned) = UPPER($1) AND drop_number != $2
           UNION
           SELECT drop_number, 'oes' as type FROM dr_photo_unified_reviews
           WHERE UPPER(oes_serial) = UPPER($1) AND drop_number != $2
           LIMIT 5`,
          [ontSerial, dropNumber]
        ).then(r => r.rows as DuplicateSerialHit[])
      );
    } else {
      queries.push(Promise.resolve([]));
    }

    // UPS duplicate check
    if (upsSerial) {
      queries.push(
        pool.query(
          `SELECT drop_number, 'ups' as type FROM dr_photo_unified_reviews
           WHERE UPPER(ups_serial_scanned) = UPPER($1) AND drop_number != $2
           LIMIT 5`,
          [upsSerial, dropNumber]
        ).then(r => r.rows as DuplicateSerialHit[])
      );
    } else {
      queries.push(Promise.resolve([]));
    }

    const results = await Promise.all(queries);
    return { ontDuplicates: results[0] || [], upsDuplicates: results[1] || [] };
  } catch (error) {
    logger.warn(`Duplicate serial check failed for ${dropNumber}`, { error });
    return empty;
  }
}

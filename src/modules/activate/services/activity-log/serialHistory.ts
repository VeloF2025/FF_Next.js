/**
 * Serial Change Tracking
 */

import { log } from '@/lib/logger';
import { logActivity } from './coreLogger';
import { getDb } from './_shared';
import type { SerialChangeSource, SerialChangeReason } from './_shared';

/**
 * Detect if a serial value looks like it's in the wrong field (swap pattern)
 */
export function detectSwapPattern(changeType: 'ont_serial' | 'ups_serial', value: string | null): boolean {
  if (!value) return false;

  // ONT serials start with ALCL or ALCB
  const isOntPattern = /^ALC[LB]/i.test(value);
  // UPS serials start with GU18W
  const isUpsPattern = /^GU18W/i.test(value);

  if (changeType === 'ont_serial' && isUpsPattern) {
    return true; // UPS serial in ONT field = swap
  }
  if (changeType === 'ups_serial' && isOntPattern) {
    return true; // ONT serial in UPS field = swap
  }

  return false;
}

/**
 * Log a serial change to both serial_change_history table and activity log
 *
 * This is the CENTRAL function for all serial change tracking.
 * Call this whenever an ONT or UPS serial value changes.
 *
 * @param drNumber - The DR number
 * @param changeType - 'ont_serial' or 'ups_serial'
 * @param oldValue - Previous serial value (null for initial capture)
 * @param newValue - New serial value
 * @param source - Where the change came from
 * @param actor - Who/what made the change
 * @param reason - Why the change was made (optional)
 * @param metadata - Additional context (optional)
 */
export async function logSerialChange(
  drNumber: string,
  changeType: 'ont_serial' | 'ups_serial',
  oldValue: string | null,
  newValue: string | null,
  source: SerialChangeSource,
  actor: string = 'system',
  reason?: SerialChangeReason,
  metadata?: Record<string, unknown>
): Promise<{ historyId: string; activityId: string }> {
  const sql = getDb();

  // Skip if no actual change (same value)
  if (oldValue === newValue) {
    log.debug(`[SerialChange] Skipped - no change for ${drNumber} ${changeType}: ${oldValue}`);
    return { historyId: '', activityId: '' };
  }

  // Detect if this looks like a swap
  const swapDetected = detectSwapPattern(changeType, newValue);

  const fullMetadata = {
    ...metadata,
    swap_detected: swapDetected,
    change_classification: oldValue === null ? 'initial_capture' : 'updated',
  };

  try {
    // 1. Insert into serial_change_history table
    const historyResult = await sql`
      INSERT INTO serial_change_history (
        drop_number,
        change_type,
        old_value,
        new_value,
        change_source,
        change_reason,
        actor,
        metadata
      )
      VALUES (
        ${drNumber},
        ${changeType},
        ${oldValue},
        ${newValue},
        ${source},
        ${reason || null},
        ${actor},
        ${JSON.stringify(fullMetadata)}
      )
      RETURNING id
    `;

    const historyId = historyResult[0]?.id || '';

    // 2. Also log to dr_activity_log for timeline display
    const eventData = {
      change_type: changeType,
      old_value: oldValue,
      new_value: newValue,
      source,
      reason,
      history_id: historyId,
      swap_detected: swapDetected,
    };

    const activityId = await logActivity(drNumber, 'SERIAL_HISTORY_ENTRY', eventData, actor);

    log.info(
      `[SerialChange] Logged ${changeType} change for ${drNumber}: ${oldValue || 'NULL'} → ${newValue || 'NULL'} (source: ${source})`
    );

    return { historyId, activityId };
  } catch (error) {
    log.error(`[SerialChange] Failed to log change for ${drNumber}: ${error}`, undefined, 'SerialHistory');
    throw error;
  }
}

/**
 * Get serial change history for a DR
 */
export async function getSerialHistory(
  drNumber: string,
  limit: number = 50
): Promise<Array<{
  id: string;
  change_type: string;
  old_value: string | null;
  new_value: string | null;
  change_source: string;
  change_reason: string | null;
  actor: string;
  metadata: Record<string, unknown>;
  detected_at: Date;
}>> {
  const sql = getDb();

  const result = await sql`
    SELECT
      id,
      change_type,
      old_value,
      new_value,
      change_source,
      change_reason,
      actor,
      metadata,
      detected_at
    FROM serial_change_history
    WHERE drop_number = ${drNumber}
    ORDER BY detected_at DESC
    LIMIT ${limit}
  `;

  return result as Array<{
    id: string;
    change_type: string;
    old_value: string | null;
    new_value: string | null;
    change_source: string;
    change_reason: string | null;
    actor: string;
    metadata: Record<string, unknown>;
    detected_at: Date;
  }>;
}

/**
 * Log WA photo VLM processing result
 *
 * Accepts an object parameter matching the actual caller in process-wa-photo-vlm.ts
 */
export async function logWaPhotoVlmProcessed(
  drNumber: string,
  data: {
    photoId: string;
    filename?: string;
    ontExtracted: string | null;
    upsExtracted: string | null;
    confidence: number;
    onemapOnt?: string | null;
    onemapUps?: string | null;
  }
): Promise<string> {
  // Determine match status by comparing extracted vs onemap serials
  let matchStatus: 'match' | 'mismatch' | 'partial' | 'no_data' = 'no_data';
  const ontMatch = data.ontExtracted && data.onemapOnt
    ? data.ontExtracted.toUpperCase() === data.onemapOnt.toUpperCase()
    : null;
  const upsMatch = data.upsExtracted && data.onemapUps
    ? data.upsExtracted.toUpperCase() === data.onemapUps.toUpperCase()
    : null;

  if (ontMatch === true && (upsMatch === true || upsMatch === null)) {
    matchStatus = 'match';
  } else if (ontMatch === false || upsMatch === false) {
    matchStatus = 'mismatch';
  } else if (ontMatch === true || upsMatch === true) {
    matchStatus = 'partial';
  }

  return logActivity(
    drNumber,
    'WA_PHOTO_VLM_PROCESSED',
    {
      photo_id: data.photoId,
      filename: data.filename,
      extracted_ont: data.ontExtracted,
      extracted_ups: data.upsExtracted,
      confidence: data.confidence,
      onemap_ont: data.onemapOnt,
      onemap_ups: data.onemapUps,
      match_status: matchStatus,
    },
    'vlm'
  );
}

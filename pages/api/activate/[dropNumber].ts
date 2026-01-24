/**
 * API Route: /api/activate/[dropNumber]
 *
 * Purpose: Fetch a single unified review by drop number
 * Methods: GET, PATCH
 *
 * Following FibreFlow standards:
 * - Uses apiResponse helper for consistent responses
 * - Neon PostgreSQL with ep-dry-night-a9qyh4sj endpoint
 * - Proper error handling and logging
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { UnifiedReview, UpdateUnifiedReviewPayload } from '@/modules/activate/types/unified.types';
import { detectSwappedSerials, looksLikeOntSerial, looksLikeGizzuSerial, fuzzySerialMatch } from '@/modules/activate/services/qaAutoFailService';
import { logSerialChange } from '@/modules/activate/services/activityLogService';

const ONEMAP_HOST = process.env.ONEMAP_HOST || 'http://100.96.203.105:8003';

// Configure Neon transport based on NEON_USE_HTTP env var
const useHttpTransport = process.env.NEON_USE_HTTP === 'true';

if (!useHttpTransport) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ws = require('ws');
    neonConfig.webSocketConstructor = ws;
  } catch {
    // ws not available, will use HTTP
  }
}

// CRITICAL: Use correct Neon endpoint (ep-dry-night-a9qyh4sj)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

/**
 * Quick sync info returned with the response
 */
interface QuickSyncInfo {
  synced: boolean;
  photosAdded: number;
  serialChanges: {
    ontChanged: boolean;
    upsChanged: boolean;
    oldOnt: string | null;
    newOnt: string | null;
    oldUps: string | null;
    newUps: string | null;
  } | null;
  swapDetected: boolean;
  swapDetails: string | null;
  /** Installation mismatch: 1Map serial ≠ OES activated serial */
  installationMismatch: {
    detected: boolean;
    oneMapSerial: string | null;
    oesSerial: string | null;
    details: string;
  } | null;
  error: string | null;
}

/**
 * Check for installation mismatch between 1Map and OES serials
 * This happens when technician replaces ONT but doesn't update 1Map
 */
async function checkInstallationMismatch(
  dropNumber: string,
  oneMapOntSerial: string | null
): Promise<QuickSyncInfo['installationMismatch']> {
  try {
    // Query OES for the activated serial
    const oesResult = await pool.query<{ serial_number: string | null }>(
      `SELECT serial_number FROM oes_activations WHERE drop_number = $1 LIMIT 1`,
      [dropNumber]
    );

    if (oesResult.rows.length === 0) {
      // DR not activated yet - no mismatch possible
      return null;
    }

    const oesSerial = oesResult.rows[0]?.serial_number || null;

    if (!oesSerial || !oneMapOntSerial) {
      // Can't compare if either is missing
      return null;
    }

    // Use fuzzy match to allow for minor OCR/scan differences (1-2 chars)
    const matchResult = fuzzySerialMatch(oneMapOntSerial, oesSerial);

    if (matchResult.isMatch) {
      // Serials match (exact or fuzzy) - no mismatch
      return null;
    }

    // Installation mismatch detected!
    return {
      detected: true,
      oneMapSerial: oneMapOntSerial,
      oesSerial: oesSerial,
      details: `1Map shows ${oneMapOntSerial} but OES activated ${oesSerial} - technician may have replaced ONT without updating 1Map`,
    };
  } catch (error) {
    log.warn(`Failed to check installation mismatch for ${dropNumber}`, { error });
    return null;
  }
}

/**
 * Quick sync from OneMap - called on every DR view
 * Compares current data with OneMap and tracks changes
 */
async function quickSyncFromOneMap(
  dropNumber: string,
  currentReview: UnifiedReview
): Promise<QuickSyncInfo> {
  const syncInfo: QuickSyncInfo = {
    synced: false,
    photosAdded: 0,
    serialChanges: null,
    swapDetected: false,
    swapDetails: null,
    installationMismatch: null,
    error: null,
  };

  try {
    // Fetch from OneMap with short timeout (5s)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 404 || response.status === 422) {
        // Record not on OneMap yet - that's OK, not an error
        return syncInfo;
      }
      syncInfo.error = `OneMap returned ${response.status}`;
      return syncInfo;
    }

    const data = await response.json();
    const localPhotos = data.local_photos || [];

    // Extract ONT serial from barcode (same logic as sync script)
    let ontSerial: string | null = null;
    if (data.ont_barcode) {
      const match = data.ont_barcode.match(/\(S\)([^(]+)/);
      if (match) {
        ontSerial = match[1].trim();
      } else if (!data.ont_barcode.includes('(')) {
        ontSerial = data.ont_barcode.trim();
      }
    }
    const upsSerial = data.ups_serial || null;

    // Current values from database
    const currentOnt = currentReview.ont_serial_scanned || null;
    const currentUps = currentReview.ups_serial_scanned || null;
    const currentPhotoCount = currentReview.photo_count || 0;

    // Detect changes
    const ontChanged = ontSerial !== currentOnt && ontSerial !== null;
    const upsChanged = upsSerial !== currentUps && upsSerial !== null;
    const photosChanged = localPhotos.length > currentPhotoCount;

    // Check for swapped serials using the new values
    const swapCheck = detectSwappedSerials(ontSerial, upsSerial);

    if (ontChanged || upsChanged || photosChanged) {
      // Map photos
      const photos = localPhotos.map((photo: { filename: string; type: string; size?: number }) => ({
        filename: photo.filename,
        step: mapPhotoTypeToStep(photo.type),
        url: `/api/activate/photo/${dropNumber}/${photo.filename}`,
        size: photo.size,
      }));

      // Update the database
      await pool.query(
        `UPDATE dr_photo_unified_reviews
         SET photo_source = COALESCE(photo_source, $1),
             photo_count = GREATEST(photo_count, $2),
             photos_metadata = CASE WHEN $2 > photo_count THEN $3 ELSE photos_metadata END,
             ont_serial_scanned = COALESCE($4, ont_serial_scanned),
             ups_serial_scanned = COALESCE($5, ups_serial_scanned),
             updated_at = NOW()
         WHERE drop_number = $6`,
        [
          'onemap',
          photos.length,
          JSON.stringify(photos),
          ontSerial,
          upsSerial,
          dropNumber,
        ]
      );

      syncInfo.synced = true;
      syncInfo.photosAdded = Math.max(0, photos.length - currentPhotoCount);

      // Track serial changes
      if (ontChanged || upsChanged) {
        syncInfo.serialChanges = {
          ontChanged,
          upsChanged,
          oldOnt: currentOnt,
          newOnt: ontSerial,
          oldUps: currentUps,
          newUps: upsSerial,
        };

        // Log serial changes to both serial_change_history AND dr_activity_log
        if (ontChanged) {
          await logSerialChange(
            dropNumber,
            'ont_serial',
            currentOnt,
            ontSerial,
            'onemap_sync',
            'system',
            undefined,
            {
              swap_detected: swapCheck.swapped,
              swap_details: swapCheck.details,
              sync_source: 'quick_sync',
            }
          );
        }
        if (upsChanged) {
          await logSerialChange(
            dropNumber,
            'ups_serial',
            currentUps,
            upsSerial,
            'onemap_sync',
            'system',
            undefined,
            {
              swap_detected: swapCheck.swapped,
              swap_details: swapCheck.details,
              sync_source: 'quick_sync',
            }
          );
        }

        log.info(`Serial change detected for ${dropNumber}`, {
          ontChanged,
          upsChanged,
          oldOnt: currentOnt,
          newOnt: ontSerial,
          oldUps: currentUps,
          newUps: upsSerial,
          swapDetected: swapCheck.swapped,
        });
      }

      // Track swap detection even if serials didn't change (for existing swapped serials)
      syncInfo.swapDetected = swapCheck.swapped;
      syncInfo.swapDetails = swapCheck.swapped ? swapCheck.details : null;

      if (swapCheck.swapped && !ontChanged && !upsChanged) {
        // Existing swapped serials - log if not already logged
        log.warn(`Swapped serials detected for ${dropNumber}`, {
          ont: ontSerial || currentOnt,
          ups: upsSerial || currentUps,
          details: swapCheck.details,
        });
      }
    } else {
      // No data changes, but still check for swap
      syncInfo.swapDetected = swapCheck.swapped;
      syncInfo.swapDetails = swapCheck.swapped ? swapCheck.details : null;
    }

    // Log SWAP_DETECTED activity (once per DR)
    if (swapCheck.swapped) {
      const existingSwapLog = await pool.query(
        `SELECT 1 FROM dr_activity_log
         WHERE drop_number = $1 AND event_type = 'SWAP_DETECTED'
         LIMIT 1`,
        [dropNumber]
      );

      if (existingSwapLog.rows.length === 0) {
        await pool.query(
          `INSERT INTO dr_activity_log (id, drop_number, event_type, event_data, actor, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
          [
            dropNumber,
            'SWAP_DETECTED',
            JSON.stringify({
              source: 'quick_sync',
              ont_serial: ontSerial || currentOnt,
              ups_serial: upsSerial || currentUps,
              details: swapCheck.details,
            }),
            'system',
          ]
        );

        log.warn(`SWAP_DETECTED logged for ${dropNumber}`, {
          ont: ontSerial || currentOnt,
          ups: upsSerial || currentUps,
          details: swapCheck.details,
        });
      }
    }

    // Check for installation mismatch (1Map serial vs OES activated serial)
    // Use the latest serial (either from sync or existing)
    const effectiveOntSerial = ontSerial || currentOnt;
    const installationMismatch = await checkInstallationMismatch(dropNumber, effectiveOntSerial);

    if (installationMismatch) {
      syncInfo.installationMismatch = installationMismatch;

      // Check if already logged (avoid duplicates)
      const existingLog = await pool.query(
        `SELECT 1 FROM dr_activity_log
         WHERE drop_number = $1 AND event_type = 'INSTALLATION_MISMATCH'
         LIMIT 1`,
        [dropNumber]
      );

      if (existingLog.rows.length === 0) {
        // First time detecting this mismatch - log to activity log
        await pool.query(
          `INSERT INTO dr_activity_log (id, drop_number, event_type, event_data, actor, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
          [
            dropNumber,
            'INSTALLATION_MISMATCH',
            JSON.stringify({
              source: 'quick_sync',
              onemap_serial: installationMismatch.oneMapSerial,
              oes_serial: installationMismatch.oesSerial,
              details: installationMismatch.details,
            }),
            'system',
          ]
        );

        log.warn(`Installation mismatch detected for ${dropNumber}`, {
          oneMapSerial: installationMismatch.oneMapSerial,
          oesSerial: installationMismatch.oesSerial,
        });
      }
    }

    return syncInfo;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      syncInfo.error = 'OneMap sync timed out (5s)';
    } else {
      syncInfo.error = error instanceof Error ? error.message : 'Unknown error';
    }
    log.warn(`Quick sync failed for ${dropNumber}`, { error: syncInfo.error });
    return syncInfo;
  }
}

/**
 * GET /api/activate/[dropNumber]
 * Fetch a single unified review (creates on-demand if not exists but DR is in qa_photo_reviews)
 */
async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  dropNumber: string
): Promise<void> {
  try {
    log.info(`Fetching unified review for ${dropNumber}`);

    // First, try to get from dr_photo_unified_reviews
    let result = await pool.query<UnifiedReview>(
      `
      SELECT
        id,
        drop_number,
        project,
        photo_source,
        photo_count,
        photos_metadata,
        step_01_house_photo,
        step_02_cable_from_pole,
        step_03_entry_outside,
        step_04_entry_inside,
        step_05_wall,
        step_06_ont_back,
        step_07_power_meter,
        step_08_final_installation,
        step_09_green_lights,
        step_10_signature,
        incorrect_steps,
        incorrect_comments,
        ai_evaluation_status,
        ai_overall_status,
        ai_average_score,
        ai_step_results,
        ai_markdown_report,
        ai_evaluated_at,
        ont_serial_scanned,
        ups_serial_scanned,
        locked_by,
        locked_at,
        feedback_sent,
        feedback_message,
        feedback_sent_at,
        reviewed_by,
        reviewed_at,
        created_at,
        updated_at,
        wa_sender_jid,
        wa_group_jid
      FROM dr_photo_unified_reviews
      WHERE drop_number = $1
      LIMIT 1;
      `,
      [dropNumber]
    );

    // If not found, check qa_photo_reviews and create on-demand
    if (result.rows.length === 0) {
      log.info(`Unified review not found, checking qa_photo_reviews for ${dropNumber}`);

      const qaResult = await pool.query(
        `SELECT drop_number, project FROM qa_photo_reviews WHERE drop_number = $1 LIMIT 1`,
        [dropNumber]
      );

      if (qaResult.rows.length === 0) {
        log.warn(`DR not found in any table: ${dropNumber}`);
        return apiResponse.notFound(res, 'Unified Review', dropNumber);
      }

      // Create unified review record from qa_photo_reviews data
      const qaData = qaResult.rows[0];
      log.info(`Creating unified review on-demand for ${dropNumber}`);

      result = await pool.query<UnifiedReview>(
        `
        INSERT INTO dr_photo_unified_reviews (
          drop_number,
          project,
          photo_source,
          photo_count,
          photos_metadata,
          incorrect_steps,
          incorrect_comments,
          created_at,
          updated_at
        ) VALUES ($1, $2, NULL, 0, '[]'::jsonb, '{}', '{}'::jsonb, NOW(), NOW())
        RETURNING *;
        `,
        [dropNumber, qaData.project]
      );

      log.info(`Created unified review for ${dropNumber}`);

      // Auto-fetch photos from OneMap after creating the record
      try {
        log.info(`Auto-fetching photos from OneMap for new record: ${dropNumber}`);
        const oneMapData = await fetchFromOneMapRecord(dropNumber);

        if (oneMapData) {
          // Update the record with photos and serial data
          await pool.query(
            `UPDATE dr_photo_unified_reviews
             SET photo_source = $1,
                 photo_count = $2,
                 photos_metadata = $3,
                 ont_serial_scanned = $4,
                 ups_serial_scanned = $5,
                 updated_at = NOW()
             WHERE drop_number = $6`,
            [
              'onemap',
              oneMapData.photos.length,
              JSON.stringify(oneMapData.photos),
              oneMapData.ont_barcode || null,
              oneMapData.ups_serial || null,
              dropNumber
            ]
          );

          // Re-fetch the updated record
          result = await pool.query<UnifiedReview>(
            `SELECT * FROM dr_photo_unified_reviews WHERE drop_number = $1`,
            [dropNumber]
          );

          log.info(`Auto-fetched ${oneMapData.photos.length} photos for ${dropNumber}`, {
            ont_barcode: oneMapData.ont_barcode,
            ups_serial: oneMapData.ups_serial,
          });
        }
      } catch (fetchError) {
        log.warn(`Auto-fetch failed for ${dropNumber}, will require manual fetch`, { error: fetchError });
        // Don't fail the request - just continue with the empty record
      }
    }

    let review = result.rows[0];

    // Auto-fetch photos for OES-only DRs (no WhatsApp submission, no photos yet)
    // This allows OES-imported DRs to get photos from OneMap when opened
    if (review && (!review.photo_source || review.photo_source === 'OES Import') && (!review.photo_count || review.photo_count === 0)) {
      try {
        log.info(`Auto-fetching photos for OES-only DR: ${dropNumber}`);
        const oneMapData = await fetchFromOneMapRecord(dropNumber);

        if (oneMapData && oneMapData.photos.length > 0) {
          // Update the record with photos and serial data
          await pool.query(
            `UPDATE dr_photo_unified_reviews
             SET photo_source = $1,
                 photo_count = $2,
                 photos_metadata = $3,
                 ont_serial_scanned = COALESCE($4, ont_serial_scanned),
                 ups_serial_scanned = COALESCE($5, ups_serial_scanned),
                 updated_at = NOW()
             WHERE drop_number = $6`,
            [
              'onemap',
              oneMapData.photos.length,
              JSON.stringify(oneMapData.photos),
              oneMapData.ont_barcode || null,
              oneMapData.ups_serial || null,
              dropNumber
            ]
          );

          // Re-fetch the updated record
          const updatedResult = await pool.query<UnifiedReview>(
            `SELECT * FROM dr_photo_unified_reviews WHERE drop_number = $1`,
            [dropNumber]
          );
          review = updatedResult.rows[0] || review;

          log.info(`Auto-fetched ${oneMapData.photos.length} photos for OES-only DR ${dropNumber}`, {
            ont_barcode: oneMapData.ont_barcode,
            ups_serial: oneMapData.ups_serial,
          });
        }
      } catch (fetchError) {
        log.warn(`Auto-fetch failed for OES-only DR ${dropNumber}`, { error: fetchError });
        // Don't fail the request - return the record without photos
      }
    }

    // Quick sync from OneMap on every view (checks for new photos and serial changes)
    let syncInfo: QuickSyncInfo | null = null;
    if (review) {
      syncInfo = await quickSyncFromOneMap(dropNumber, review);

      // If sync made changes, re-fetch the updated record
      if (syncInfo.synced) {
        const refreshedResult = await pool.query<UnifiedReview>(
          `SELECT * FROM dr_photo_unified_reviews WHERE drop_number = $1`,
          [dropNumber]
        );
        if (refreshedResult.rows[0]) {
          review = refreshedResult.rows[0];
        }
      }
    }

    log.info(`Successfully fetched unified review: ${dropNumber}`, {
      syncInfo: syncInfo ? {
        synced: syncInfo.synced,
        photosAdded: syncInfo.photosAdded,
        serialsChanged: !!syncInfo.serialChanges,
        swapDetected: syncInfo.swapDetected,
        installationMismatch: !!syncInfo.installationMismatch,
      } : null,
    });

    // Return review with sync info
    return apiResponse.success(res, {
      ...review,
      _syncInfo: syncInfo,
    });
  } catch (error) {
    log.error('Error fetching unified review:', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * PATCH /api/activate/[dropNumber]
 * Update a unified review (manual QA steps, incorrect tracking, etc.)
 */
async function handlePatch(
  req: NextApiRequest,
  res: NextApiResponse,
  dropNumber: string
): Promise<void> {
  try {
    const payload = req.body as UpdateUnifiedReviewPayload;

    log.info(`Updating unified review: ${dropNumber}`, { updates: Object.keys(payload) });

    // Build dynamic UPDATE query based on provided fields
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    // Manual QA steps (10 photo steps)
    const stepFields: (keyof UpdateUnifiedReviewPayload)[] = [
      'step_01_house_photo',
      'step_02_cable_from_pole',
      'step_03_entry_outside',
      'step_04_entry_inside',
      'step_05_wall',
      'step_06_ont_back',
      'step_07_power_meter',
      'step_08_final_installation',
      'step_09_green_lights',
      'step_10_signature',
    ];

    stepFields.forEach((field) => {
      if (field in payload) {
        updates.push(`${field} = $${paramIndex++}`);
        values.push(payload[field]);
      }
    });

    // Incorrect tracking
    if ('incorrect_steps' in payload) {
      updates.push(`incorrect_steps = $${paramIndex++}`);
      values.push(payload.incorrect_steps);
    }

    if ('incorrect_comments' in payload) {
      updates.push(`incorrect_comments = $${paramIndex++}`);
      values.push(JSON.stringify(payload.incorrect_comments));
    }

    // Serial scanning
    if ('ont_serial_scanned' in payload) {
      updates.push(`ont_serial_scanned = $${paramIndex++}`);
      values.push(payload.ont_serial_scanned);
    }

    if ('ups_serial_scanned' in payload) {
      updates.push(`ups_serial_scanned = $${paramIndex++}`);
      values.push(payload.ups_serial_scanned);
    }

    // Feedback
    if ('feedback_message' in payload) {
      updates.push(`feedback_message = $${paramIndex++}`);
      values.push(payload.feedback_message);
    }

    // Metadata
    if ('reviewed_by' in payload) {
      updates.push(`reviewed_by = $${paramIndex++}`);
      values.push(payload.reviewed_by);
      updates.push(`reviewed_at = NOW()`);
    }

    // Always update updated_at
    updates.push(`updated_at = NOW()`);

    if (updates.length === 1) {
      // Only updated_at, no actual changes
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'No fields to update');
    }

    // Add drop_number as final parameter
    values.push(dropNumber);

    const result = await pool.query<UnifiedReview>(
      `
      UPDATE dr_photo_unified_reviews
      SET ${updates.join(', ')}
      WHERE drop_number = $${paramIndex}
      RETURNING *;
      `,
      values
    );

    if (result.rows.length === 0) {
      log.warn(`Unified review not found for update: ${dropNumber}`);
      return apiResponse.notFound(res, 'Unified Review', dropNumber);
    }

    const updatedReview = result.rows[0];

    log.info(`Successfully updated unified review: ${dropNumber}`);
    return apiResponse.success(res, updatedReview);
  } catch (error) {
    log.error('Error updating unified review:', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Map photo type to unified step number (10 steps)
 *
 * NOTE: ONT Barcode and UPS Serial are NOT photo steps - they are scanned
 * barcodes stored directly in ont_serial_scanned and ups_serial_scanned fields.
 */
function mapPhotoTypeToStep(photoType: string): number {
  const mapping: Record<string, number> = {
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
    // Step 8: Final Installation (was step 10)
    'ph_after': 8, 'ph_final': 8,
    // Step 9: Green Lights on ONT (was step 11)
    'ph_lights': 9, 'ph_led': 9,
    // Step 10: Signature (was step 12)
    'ph_sign2': 10, 'ph_signature': 10,
  };
  return mapping[photoType] || 0;
}

/**
 * Fetch DR record from OneMap API (includes photos + serial numbers)
 */
async function fetchFromOneMapRecord(dropNumber: string): Promise<{
  photos: Array<{ filename: string; step: number; url: string; size?: number }>;
  ont_barcode: string | null;
  ups_serial: string | null;
} | null> {
  try {
    // Try to get the full record
    let response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`);

    // If 404, try to download first
    if (response.status === 404 || response.status === 422) {
      log.info(`Record not found for ${dropNumber}, triggering download`);

      const downloadResponse = await fetch(`${ONEMAP_HOST}/api/download/${dropNumber}`, {
        method: 'POST',
      });

      if (downloadResponse.ok) {
        // Retry after download
        response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`);
      } else {
        log.warn(`Download failed for ${dropNumber}`);
        return null;
      }
    }

    if (!response.ok) {
      log.warn(`OneMap API error for ${dropNumber}: ${response.status}`);
      return null;
    }

    let data = await response.json();
    let localPhotos = data.local_photos || [];

    // If record exists but local_photos is empty, try downloading
    if (localPhotos.length === 0 && data.photo_count > 0) {
      log.info(`Record exists but no local photos for ${dropNumber}, triggering download`);

      const downloadResponse = await fetch(`${ONEMAP_HOST}/api/download/${dropNumber}`, {
        method: 'POST',
      });

      if (downloadResponse.ok) {
        // Re-fetch record after download
        const retryResponse = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`);
        if (retryResponse.ok) {
          data = await retryResponse.json();
          localPhotos = data.local_photos || [];
          log.info(`Downloaded ${localPhotos.length} photos for ${dropNumber}`);
        }
      } else {
        log.warn(`Download failed for ${dropNumber}`);
      }
    }

    // Map photos with proxy URLs
    const photos = localPhotos.map((photo: { filename: string; type: string; size?: number }) => ({
      filename: photo.filename,
      step: mapPhotoTypeToStep(photo.type),
      url: `/api/activate/photo/${dropNumber}/${photo.filename}`,
      size: photo.size,
    }));

    return {
      photos,
      ont_barcode: data.ont_barcode || null,
      ups_serial: data.ups_serial || null,
    };
  } catch (error) {
    log.error(`Failed to fetch from OneMap for ${dropNumber}`, { error });
    return null;
  }
}

/**
 * Main handler
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  const { dropNumber } = req.query;

  // Validate dropNumber parameter
  if (!dropNumber || typeof dropNumber !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Invalid drop number parameter');
  }

  switch (req.method) {
    case 'GET':
      return handleGet(req, res, dropNumber);

    case 'PATCH':
      return handlePatch(req, res, dropNumber);

    default:
      return apiResponse.methodNotAllowed(res);
  }
}

export default withAuth(handler);

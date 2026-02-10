/**
 * API Route: /api/activate/dr-acknowledgment
 *
 * Purpose: Get immediate acknowledgment data for a DR submission
 * Method: POST
 *
 * Returns photo count, ONT serial, UPS serial, and pre-formatted WhatsApp message.
 * This is a lightweight read-only query - does NOT trigger photo downloads.
 *
 * Used by Go WhatsApp Bridge to send immediate reply to DR submissions.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
// Webhook auth: verified via shared bridge secret (not withAuth - called by Go WhatsApp Bridge)
import pool from '@/lib/db';
import { log } from '@/lib/logger';

const BRIDGE_SECRET = process.env.WA_BRIDGE_SECRET;
import { detectSwappedSerials, looksLikeOntSerial, looksLikeGizzuSerial } from '@/modules/activate/services/qaAutoFailService';
import { extractWaPhotoSerials, waitForWaPhotos } from '@/modules/activate/services/serialVerificationService';

// Vercel: Allow up to 30s for delayed VLM serial extraction
export const config = { maxDuration: 30 };

// BOSS API - Docker container on Velocity that caches 1Map photo data
// LEGITIMATE USE: This endpoint is called once per DR submission to check
// if the DR exists in 1Map and get current photo/serial status for the
// acknowledgment message. DR doesn't exist in unified table yet at this point.
const BOSS_API_HOST = process.env.BOSS_API_HOST || 'http://100.96.203.105:8003';

interface ExistingSubmission {
  submission_count: number;
  photo_count: number;
  feedback_message: string | null;
  qa_decision: string | null;
}

interface DuplicateSerialHit {
  drop_number: string;
  type: 'ont' | 'ups' | 'oes';
}

interface DuplicateSerialResult {
  ontDuplicates: DuplicateSerialHit[];
  upsDuplicates: DuplicateSerialHit[];
}

interface WAPhotoCheck {
  hasPhoto: boolean;
  photoCount: number;
}

interface AckRequest {
  dropNumber: string;
  project?: string;
}

interface OneMapRecordResponse {
  dr_number: string;
  site?: string;
  site_name?: string;
  status?: string;
  photo_count?: number;
  local_photos?: Array<{ filename: string; type?: string }>;
  ont_barcode?: string | null;
  ups_serial?: string | null;
}

interface DropsTableRecord {
  drop_number: string;
  pole_number: string | null;
  project_name: string | null;
  project_id: string | null;
}

/**
 * Extract ONT serial from barcode scan data
 * Barcode format: (S)SERIAL(23S)CODE(20S)CODE(U)user(P)pass(ID)id(KY)key(N)model
 * We want just the serial after (S) and before the next (
 */
function extractOntSerial(barcodeData: string | null): string | null {
  if (!barcodeData) return null;

  // Look for (S) pattern and extract the value after it
  const serialMatch = barcodeData.match(/\(S\)([^(]+)/);
  if (serialMatch && serialMatch[1]) {
    return serialMatch[1].trim();
  }

  // If no (S) pattern, check if it's just a plain serial (no parentheses)
  if (!barcodeData.includes('(')) {
    return barcodeData.trim();
  }

  return null;
}

/**
 * Check if DR has WhatsApp serial photos submitted
 */
async function checkWAPhotos(dropNumber: string): Promise<WAPhotoCheck> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM wa_photos
       WHERE drop_number = $1 AND purpose = 'activation'`,
      [dropNumber]
    );
    const count = parseInt(result.rows[0]?.count || '0', 10);
    return { hasPhoto: count > 0, photoCount: count };
  } catch (error) {
    log.warn('DrAcknowledgment', `Failed to check WA photos for ${dropNumber}`, { error });
    return { hasPhoto: false, photoCount: 0 };
  }
}

/**
 * Check if DR already exists in our database (resubmission detection)
 */
async function checkExistingSubmission(dropNumber: string): Promise<ExistingSubmission | null> {
  try {
    const result = await pool.query(
      `SELECT submission_count, photo_count, feedback_message, qa_decision
       FROM dr_photo_unified_reviews
       WHERE drop_number = $1`,
      [dropNumber]
    );
    return result.rows[0] || null;
  } catch (error) {
    log.warn('DrAcknowledgment', `Failed to check existing submission for ${dropNumber}`, { error });
    return null;
  }
}

/**
 * Check if DR exists in our drops table (imported from OES)
 * Fallback when DR not found in 1Map - means DR is valid but sign-up not yet in 1Map
 */
async function checkDropsTable(dropNumber: string): Promise<DropsTableRecord | null> {
  try {
    const result = await pool.query(
      `SELECT d.drop_number, d.pole_number, d.project_id, p.project_name
       FROM drops d
       LEFT JOIN projects p ON d.project_id = p.id
       WHERE d.drop_number = $1
       LIMIT 1`,
      [dropNumber]
    );
    return result.rows[0] || null;
  } catch (error) {
    log.warn('DrAcknowledgment', `Failed to check drops table for ${dropNumber}`, { error });
    return null;
  }
}

/**
 * Check for duplicate serials across other DRs
 * Non-critical: returns empty on failure so ack message still sends
 */
async function checkDuplicateSerials(
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
    log.warn('DrAcknowledgment', `Duplicate serial check failed for ${dropNumber}`, { error });
    return empty;
  }
}

/**
 * Build serial warning lines for ack messages
 * Shared by generateAckMessage() and generateResubmissionAckMessage()
 */
function buildSerialWarningLines(
  ontSerial: string | null,
  upsSerial: string | null,
  vlmResult: { ontSerial: string | null; upsSerial: string | null; confidence: number } | undefined,
  duplicates: DuplicateSerialResult
): string[] {
  const lines: string[] = [];

  // --- ONT Serial ---
  if (ontSerial) {
    if (vlmResult?.ontSerial && normalizeForCompare(ontSerial) !== normalizeForCompare(vlmResult.ontSerial)) {
      lines.push(`🔴 *ONT Serial MISMATCH:*`);
      lines.push(`   1Map: ${ontSerial}`);
      lines.push(`   Sticker: ${vlmResult.ontSerial}`);
      lines.push(`   ⚠️ *Please correct in 1Map!*`);
    } else if (vlmResult?.ontSerial) {
      lines.push(`🔌 ONT Serial: ${ontSerial} ✅`);
    } else {
      lines.push(`🔌 ONT Serial: ${ontSerial}`);
    }
  } else {
    lines.push(`🔴 *ONT Serial: NOT SCANNED*`);
    lines.push(`   ⚠️ *Please scan ONT barcode in 1Map!*`);
    if (vlmResult?.ontSerial) {
      lines.push(`   📷 Photo shows: ${vlmResult.ontSerial}`);
    }
  }

  // ONT duplicate warning
  if (duplicates.ontDuplicates.length > 0) {
    const drList = duplicates.ontDuplicates.map(d => d.drop_number).join(', ');
    lines.push(`🔴 *ONT Serial ${ontSerial} already used on ${drList}!*`);
    lines.push(`   ⚠️ *Please verify this is the correct serial*`);
  }

  // --- UPS Serial ---
  if (upsSerial) {
    if (vlmResult?.upsSerial && normalizeForCompare(upsSerial) !== normalizeForCompare(vlmResult.upsSerial)) {
      lines.push(`🔴 *UPS Serial MISMATCH:*`);
      lines.push(`   1Map: ${upsSerial}`);
      lines.push(`   Sticker: ${vlmResult.upsSerial}`);
      lines.push(`   ⚠️ *Please correct in 1Map!*`);
    } else if (vlmResult?.upsSerial) {
      lines.push(`🔋 UPS Serial: ${upsSerial} ✅`);
    } else {
      lines.push(`🔋 UPS Serial: ${upsSerial}`);
    }
  } else {
    lines.push(`🔴 *UPS Serial: NOT SCANNED*`);
    lines.push(`   ⚠️ *Please scan UPS barcode in 1Map!*`);
    if (vlmResult?.upsSerial) {
      lines.push(`   📷 Photo shows: ${vlmResult.upsSerial}`);
    }
  }

  // UPS duplicate warning
  if (duplicates.upsDuplicates.length > 0) {
    const drList = duplicates.upsDuplicates.map(d => d.drop_number).join(', ');
    lines.push(`🔴 *UPS Serial ${upsSerial} already used on ${drList}!*`);
    lines.push(`   ⚠️ *Please verify this is the correct serial*`);
  }

  return lines;
}

/**
 * Update onemap_status in dr_photo_unified_reviews
 * Creates record if not exists (UPSERT)
 */
async function updateOneMapStatus(
  dropNumber: string,
  status: 'found' | 'not_found' | 'resolved'
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO dr_photo_unified_reviews (drop_number, onemap_status, onemap_checked_at, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW(), NOW())
       ON CONFLICT (drop_number) DO UPDATE SET
         onemap_status = $2,
         onemap_checked_at = NOW(),
         updated_at = NOW()`,
      [dropNumber, status]
    );
    log.info('DrAcknowledgment', `Set onemap_status=${status} for ${dropNumber}`);
  } catch (error) {
    log.warn('DrAcknowledgment', `Failed to update onemap_status for ${dropNumber}`, { error });
  }
}

/**
 * Generate warning acknowledgment for DRs in drops table but NOT in 1Map
 * Warns that home sign-up hasn't been completed
 */
function generateNotOnOneMapMessage(
  dropNumber: string,
  dropsRecord: DropsTableRecord,
  waPhotoCheck: WAPhotoCheck
): { message: string; swapped: boolean; swapDetails: string | null } {
  const lines: string[] = [];

  lines.push(`⚠️ *${dropNumber} Received - NOT ON 1MAP*`);
  lines.push('');
  lines.push('It looks like the home sign-up for this DR has not been completed.');
  lines.push('Please check that first.');
  lines.push('');

  // Project info if available
  if (dropsRecord.project_name) {
    lines.push(`📍 Project: ${dropsRecord.project_name}`);
  }
  if (dropsRecord.pole_number) {
    lines.push(`📍 Pole: ${dropsRecord.pole_number}`);
  }
  lines.push('');

  // WA serial photo check
  if (waPhotoCheck.hasPhoto) {
    lines.push(`📷 Serial photo: ✅ Received`);
  } else {
    lines.push('📷 Serial photo: ❌ Not received');
  }
  lines.push('');

  lines.push('⚠️ This DR will be tracked and checked again once 1Map is updated.');

  return {
    message: lines.join('\n'),
    swapped: false,
    swapDetails: null,
  };
}

/**
 * Mark DR for rework and reset QA workflow for resubmission
 *
 * This function:
 * 1. Snapshots current state into submission_history
 * 2. Increments submission_count
 * 3. Resets qa_phase to null (re-enter workflow from start)
 * 4. Resets feedback_sent to allow new feedback
 * 5. Sets qa_decision to 'REWORK_NEEDED' temporarily (will be cleared when reviewed)
 */
async function markForRework(dropNumber: string, newPhotoCount: number): Promise<void> {
  try {
    // First, snapshot current state and reset for new submission
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
    log.info('DrAcknowledgment', `Reset ${dropNumber} for QA re-review (resubmission)`, {
      newPhotoCount,
    });
  } catch (error) {
    log.warn('DrAcknowledgment', `Failed to mark ${dropNumber} for rework`, { error });
  }
}

/**
 * Save swap detection to database for tracking
 * Creates/updates record in dr_photo_unified_reviews with swap status
 */
async function saveSwapDetection(
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
    log.info('DrAcknowledgment', `Saved swap detection for ${dropNumber}`, { swapDetails });
  } catch (error) {
    log.warn('DrAcknowledgment', `Failed to save swap detection for ${dropNumber}`, { error });
  }
}

/**
 * Generate WhatsApp acknowledgment message for RESUBMISSION
 */
function generateResubmissionAckMessage(
  dropNumber: string,
  newPhotoCount: number,
  previousPhotoCount: number,
  submissionNumber: number,
  ontSerial: string | null,
  upsSerial: string | null,
  vlmResult?: { ontSerial: string | null; upsSerial: string | null; confidence: number },
  duplicates: DuplicateSerialResult = { ontDuplicates: [], upsDuplicates: [] }
): { message: string; swapped: boolean; swapDetails: string | null } {
  const swapCheck = detectSwappedSerials(ontSerial, upsSerial);
  const lines: string[] = [];

  // Header - distinct from normal submission
  lines.push(`🔄 *${dropNumber} Resubmitted!*`);
  lines.push('');
  lines.push(`This is submission #${submissionNumber} for this DR.`);
  lines.push('');

  // CRITICAL: Swapped serials warning
  if (swapCheck.swapped) {
    lines.push('🔴 *ALERT: SERIALS APPEAR SWAPPED*');
    lines.push('');
    if (ontSerial && looksLikeGizzuSerial(ontSerial)) {
      lines.push(`❌ ONT field has Gizzu serial: ${ontSerial}`);
    }
    if (upsSerial && looksLikeOntSerial(upsSerial)) {
      lines.push(`❌ UPS field has ONT serial: ${upsSerial}`);
    }
    lines.push('');
    lines.push('*Please correct in 1Map:*');
    lines.push('• ONT should be ALCL/ALCB serial');
    lines.push('• UPS should be GU18W serial (Gizzu)');
    lines.push('');
  }

  // Photo count comparison
  lines.push(`📸 Photos: ${newPhotoCount} (was ${previousPhotoCount})`);

  // Serial warnings using shared helper
  if (swapCheck.swapped) {
    lines.push(`⚠️ ONT field: ${ontSerial || 'Not scanned'}`);
    lines.push(`⚠️ UPS field: ${upsSerial || 'Not scanned'}`);
    if (vlmResult?.ontSerial || vlmResult?.upsSerial) {
      lines.push('');
      lines.push(`📷 Photo serials: ONT=${vlmResult.ontSerial || '?'} UPS=${vlmResult.upsSerial || '?'}`);
    }
  } else {
    lines.push(...buildSerialWarningLines(ontSerial, upsSerial, vlmResult, duplicates));
  }
  lines.push('');

  // Footer - emphasize rework
  lines.push('⚠️ Marked for QA re-review.');
  lines.push('Previous feedback will be considered.');

  return {
    message: lines.join('\n'),
    swapped: swapCheck.swapped,
    swapDetails: swapCheck.swapped ? swapCheck.details : null,
  };
}

/**
 * Normalize serial for comparison (case-insensitive, trimmed)
 */
function normalizeForCompare(serial: string): string {
  return serial.trim().toUpperCase();
}

/**
 * Generate WhatsApp acknowledgment message
 * Returns empty string if DR not found - Go bridge will skip sending
 *
 * IMPORTANT: Detects swapped serials (ONT in UPS field or vice versa) and warns immediately
 * Also warns if no WhatsApp serial sticker photo was received with the DR submission
 */
function generateAckMessage(
  dropNumber: string,
  found: boolean,
  photoCount: number,
  ontSerial: string | null,
  upsSerial: string | null,
  waPhotoCheck: WAPhotoCheck = { hasPhoto: false, photoCount: 0 },
  vlmResult?: { ontSerial: string | null; upsSerial: string | null; confidence: number },
  duplicates: DuplicateSerialResult = { ontDuplicates: [], upsDuplicates: [] }
): { message: string; swapped: boolean; swapDetails: string | null } {
  // If DR not found in 1Map, return empty string
  // Go bridge checks for empty message and won't send anything
  // This prevents confusing "Received!" messages for invalid DRs
  if (!found) {
    return { message: '', swapped: false, swapDetails: null };
  }

  // Check for swapped serials - this is critical!
  const swapCheck = detectSwappedSerials(ontSerial, upsSerial);
  const lines: string[] = [];

  // Header
  lines.push(`📸 *${dropNumber} Received!*`);
  lines.push('');

  // CRITICAL: Swapped serials warning at the top
  if (swapCheck.swapped) {
    lines.push('🔴 *ALERT: SERIALS APPEAR SWAPPED*');
    lines.push('');
    // Show what's in each field
    if (ontSerial && looksLikeGizzuSerial(ontSerial)) {
      lines.push(`❌ ONT field has Gizzu serial: ${ontSerial}`);
    }
    if (upsSerial && looksLikeOntSerial(upsSerial)) {
      lines.push(`❌ UPS field has ONT serial: ${upsSerial}`);
    }
    lines.push('');
    lines.push('*Please correct in 1Map:*');
    lines.push('• ONT should be ALCL/ALCB serial');
    lines.push('• UPS should be GU18W serial (Gizzu)');
    lines.push('');
  }

  // Photo count
  const photoLine =
    photoCount > 0 ? `✅ Photos: ${photoCount}` : `⚠️ Photos: None found - please upload to 1Map`;
  lines.push(photoLine);

  // WA serial photo check - warn if not received
  if (waPhotoCheck.hasPhoto) {
    lines.push(`📷 Serial photo: ✅ Received`);
  } else {
    lines.push('');
    lines.push('⚠️ *No serial photo received*');
    lines.push('Please send ONT & UPS sticker photo with DR');
  }

  // Serial status (with swap consideration, VLM comparison, and duplicate detection)
  if (swapCheck.swapped) {
    // Already warned above, just show the raw values
    lines.push(`⚠️ ONT field: ${ontSerial || 'Not scanned'}`);
    lines.push(`⚠️ UPS field: ${upsSerial || 'Not scanned'}`);
    // Show VLM serials for reference even when swapped
    if (vlmResult?.ontSerial || vlmResult?.upsSerial) {
      lines.push('');
      lines.push(`📷 Photo serials: ONT=${vlmResult.ontSerial || '?'} UPS=${vlmResult.upsSerial || '?'}`);
    }
  } else {
    lines.push(...buildSerialWarningLines(ontSerial, upsSerial, vlmResult, duplicates));
  }

  lines.push('');

  // Footer
  if (swapCheck.swapped) {
    lines.push('⚠️ Please correct the swapped serials before QA review.');
  } else {
    lines.push('Thank you! QA review will follow shortly.');
  }

  return {
    message: lines.join('\n'),
    swapped: swapCheck.swapped,
    swapDetails: swapCheck.swapped ? swapCheck.details : null,
  };
}

async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const startTime = Date.now();

  try {
    const { dropNumber, project } = req.body as AckRequest;

    if (!dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }

    log.info('DrAcknowledgment', `Getting acknowledgment data for ${dropNumber}`, { project });

    // Check if this is a resubmission
    // IMPORTANT: A bare record created by updateOneMapStatus, process-new-dr, or OES import
    // is NOT a real resubmission. Only treat as resubmission if the DR has been through
    // QA review at least once (qa_decision set) or feedback was sent (feedback_message set).
    // Without this check, concurrent calls from Go Bridge cause false resubmission detection.
    // See: .claude/knowledge-base/activate/dr-acknowledgment-race-condition.md
    const existingSubmission = await checkExistingSubmission(dropNumber);
    const isResubmission = existingSubmission !== null && (
      existingSubmission.qa_decision !== null ||
      existingSubmission.feedback_message !== null
    );
    let submissionNumber = 1;
    let previousPhotoCount = 0;

    if (isResubmission) {
      submissionNumber = (existingSubmission.submission_count || 1) + 1;
      previousPhotoCount = existingSubmission.photo_count || 0;
      log.info('DrAcknowledgment', `RESUBMISSION detected for ${dropNumber}`, {
        previousSubmissions: existingSubmission.submission_count,
        previousPhotoCount,
        qaDecision: existingSubmission.qa_decision,
      });
    } else if (existingSubmission !== null) {
      log.info('DrAcknowledgment', `Record exists for ${dropNumber} but no QA decision yet - treating as first submission`, {
        submissionCount: existingSubmission.submission_count,
        qaDecision: existingSubmission.qa_decision,
        feedbackMessage: existingSubmission.feedback_message ? 'yes' : 'no',
      });
    }

    let found = false;
    let photoCount = 0;
    let ontSerial: string | null = null;
    let upsSerial: string | null = null;

    try {
      // Read-only query to OneMap - do NOT use /api/download which triggers fetching
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(`${BOSS_API_HOST}/api/record/${dropNumber}`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = (await response.json()) as OneMapRecordResponse;
        found = true;
        photoCount = data.photo_count || data.local_photos?.length || 0;
        ontSerial = extractOntSerial(data.ont_barcode);
        upsSerial = data.ups_serial || null;

        log.info('DrAcknowledgment', `OneMap data for ${dropNumber}`, {
          photoCount,
          hasOnt: !!ontSerial,
          hasUps: !!upsSerial,
        });
      } else if (response.status === 404 || response.status === 422) {
        log.info('DrAcknowledgment', `DR ${dropNumber} not found in OneMap`);
      } else {
        log.warn('DrAcknowledgment', `OneMap returned ${response.status} for ${dropNumber}`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        log.warn('DrAcknowledgment', `OneMap timeout for ${dropNumber}`);
      } else {
        log.warn('DrAcknowledgment', `OneMap query failed for ${dropNumber}`, { error });
      }
      // Continue with found=false - don't fail the request
    }

    // Start duplicate serial check in parallel with WA photo polling (adds 0ms wall-clock time)
    const duplicateCheckPromise = (ontSerial || upsSerial)
      ? checkDuplicateSerials(dropNumber, ontSerial, upsSerial)
      : Promise.resolve({ ontDuplicates: [], upsDuplicates: [] } as DuplicateSerialResult);

    // Poll for WhatsApp serial photos and run VLM serial extraction
    // Race condition: Go Bridge creates wa_photos records asynchronously
    let waPhotoCheck: WAPhotoCheck = { hasPhoto: false, photoCount: 0 };
    let vlmResult: { ontSerial: string | null; upsSerial: string | null; confidence: number } | undefined;

    try {
      // Poll for wa_photos (Go Bridge creates them in parallel with this call)
      const photosReady = await waitForWaPhotos(dropNumber, 10000, 2000);

      if (photosReady) {
        waPhotoCheck = await checkWAPhotos(dropNumber);
        log.info('DrAcknowledgment', `WA photos found for ${dropNumber}, running VLM extraction`, {
          waPhotoCount: waPhotoCheck.photoCount,
        });

        // Run VLM serial extraction from sticker photo
        const extraction = await extractWaPhotoSerials(dropNumber, {
          force: false,
          timeoutMs: 8000,
        });

        if (extraction.bestOnt || extraction.bestUps) {
          vlmResult = {
            ontSerial: extraction.bestOnt?.serial || null,
            upsSerial: extraction.bestUps?.serial || null,
            confidence: Math.max(
              extraction.bestOnt?.confidence || 0,
              extraction.bestUps?.confidence || 0
            ),
          };
          log.info('DrAcknowledgment', `VLM serial extraction completed for ${dropNumber}`, {
            ontExtracted: vlmResult.ontSerial,
            upsExtracted: vlmResult.upsSerial,
            confidence: vlmResult.confidence,
            photosProcessed: extraction.photosProcessed,
          });
        } else {
          log.info('DrAcknowledgment', `VLM found no serials in ${extraction.photosProcessed} photos for ${dropNumber}`);
        }
      } else {
        // No photos appeared within timeout
        waPhotoCheck = await checkWAPhotos(dropNumber);
        log.info('DrAcknowledgment', `No WA photos appeared for ${dropNumber} within timeout`);
      }
    } catch (vlmError) {
      // VLM failure is non-critical - fall back to 1Map serials only
      log.warn('DrAcknowledgment', `VLM extraction failed for ${dropNumber} - using 1Map only`, {
        error: vlmError instanceof Error ? vlmError.message : String(vlmError),
      });
      waPhotoCheck = await checkWAPhotos(dropNumber);
    }

    // Await duplicate check (was running in parallel with WA photo polling)
    const duplicates = await duplicateCheckPromise;
    if (duplicates.ontDuplicates.length > 0 || duplicates.upsDuplicates.length > 0) {
      log.warn('DrAcknowledgment', `Duplicate serials found for ${dropNumber}`, {
        ontDuplicates: duplicates.ontDuplicates.map(d => d.drop_number),
        upsDuplicates: duplicates.upsDuplicates.map(d => d.drop_number),
      });
    }

    // Generate appropriate message based on whether this is a resubmission
    let ackResult: { message: string; swapped: boolean; swapDetails: string | null };
    let notOnOneMap = false;

    if (isResubmission && found) {
      // Resubmission - use special template and mark for rework
      ackResult = generateResubmissionAckMessage(
        dropNumber,
        photoCount,
        previousPhotoCount,
        submissionNumber,
        ontSerial,
        upsSerial,
        vlmResult,
        duplicates
      );
      // Mark for QA re-review and reset workflow
      await markForRework(dropNumber, photoCount);
      // Track 1Map status
      await updateOneMapStatus(dropNumber, 'found');
    } else if (!found) {
      // DR not in 1Map - check drops table as fallback
      const dropsRecord = await checkDropsTable(dropNumber);

      if (dropsRecord) {
        // DR exists in our drops table but NOT in 1Map
        // Send warning ack about home sign-up not complete
        notOnOneMap = true;
        ackResult = generateNotOnOneMapMessage(dropNumber, dropsRecord, waPhotoCheck);
        log.warn('DrAcknowledgment', `DR ${dropNumber} found in drops but NOT in 1Map`, {
          project: dropsRecord.project_name,
          pole: dropsRecord.pole_number,
        });
        // Track as not_found in 1Map
        await updateOneMapStatus(dropNumber, 'not_found');
      } else {
        // DR not in 1Map AND not in drops - truly unknown
        ackResult = generateAckMessage(dropNumber, false, photoCount, ontSerial, upsSerial, waPhotoCheck, vlmResult, duplicates);
        log.info('DrAcknowledgment', `DR ${dropNumber} not found in 1Map or drops - no ack`);
      }
    } else {
      // Normal first submission found in 1Map
      ackResult = generateAckMessage(dropNumber, found, photoCount, ontSerial, upsSerial, waPhotoCheck, vlmResult, duplicates);
      // Track 1Map status
      await updateOneMapStatus(dropNumber, 'found');
    }

    const duration = Date.now() - startTime;

    if (!found && !notOnOneMap) {
      log.info('DrAcknowledgment', `DR ${dropNumber} not found anywhere - no ack sent`);
    } else if (notOnOneMap) {
      log.info('DrAcknowledgment', `DR ${dropNumber} NOT ON 1MAP - warning ack sent in ${duration}ms`);
    } else if (isResubmission) {
      log.info('DrAcknowledgment', `Resubmission acknowledgment ready for ${dropNumber}`, {
        submissionNumber,
        photoCount,
        previousPhotoCount,
        duration: `${duration}ms`,
      });
    } else if (ackResult.swapped) {
      log.warn('DrAcknowledgment', `SWAPPED SERIALS detected for ${dropNumber}`, {
        ontSerial,
        upsSerial,
        details: ackResult.swapDetails,
      });
      // Save swap detection to database for tracking
      await saveSwapDetection(dropNumber, ontSerial, upsSerial, ackResult.swapDetails);
    } else {
      log.info('DrAcknowledgment', `Acknowledgment ready for ${dropNumber} in ${duration}ms`);
    }

    return apiResponse.success(res, {
      dropNumber,
      found: found || notOnOneMap,
      photoCount,
      ontSerial,
      upsSerial,
      message: ackResult.message,
      serialsSwapped: ackResult.swapped,
      swapDetails: ackResult.swapDetails,
      // 1Map status
      notOnOneMap,
      // Resubmission info
      isResubmission,
      submissionNumber,
      previousPhotoCount: isResubmission ? previousPhotoCount : null,
      // WA serial photo info
      waSerialPhoto: {
        received: waPhotoCheck.hasPhoto,
        count: waPhotoCheck.photoCount,
      },
      vlmSerialCheck: vlmResult ? {
        ontSerial: vlmResult.ontSerial,
        upsSerial: vlmResult.upsSerial,
        confidence: vlmResult.confidence,
        ontMatch: ontSerial && vlmResult.ontSerial
          ? normalizeForCompare(ontSerial) === normalizeForCompare(vlmResult.ontSerial)
          : null,
        upsMatch: upsSerial && vlmResult.upsSerial
          ? normalizeForCompare(upsSerial) === normalizeForCompare(vlmResult.upsSerial)
          : null,
      } : null,
      // Duplicate serial detection (Go Bridge ignores unknown fields)
      duplicateSerials: (duplicates.ontDuplicates.length > 0 || duplicates.upsDuplicates.length > 0) ? {
        ont: duplicates.ontDuplicates.map(d => d.drop_number),
        ups: duplicates.upsDuplicates.map(d => d.drop_number),
      } : null,
    });
  } catch (error) {
    log.error('DrAcknowledgment', 'Error generating acknowledgment', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  // Verify bridge secret to prevent unauthorized access
  if (!BRIDGE_SECRET) {
    log.error('[dr-acknowledgment] WA_BRIDGE_SECRET env var not set');
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Server configuration error');
  }
  const secret = req.body?.secret || req.headers['x-bridge-secret'];
  if (secret !== BRIDGE_SECRET) {
    return apiResponse.error(res, ErrorCode.UNAUTHORIZED, 'Invalid bridge secret');
  }

  if (req.method === 'POST') {
    return handlePost(req, res);
  }
  return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
}

// Webhook endpoint - authenticated via bridge secret
export default handler;

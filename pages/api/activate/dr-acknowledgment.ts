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
import { neonConfig, Pool } from '@neondatabase/serverless';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
// NOTE: No withAuth - this endpoint is called by Go WhatsApp Bridge without credentials
import { log } from '@/lib/logger';
import { detectSwappedSerials, looksLikeOntSerial, looksLikeGizzuSerial } from '@/modules/activate/services/qaAutoFailService';

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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const ONEMAP_HOST = process.env.ONEMAP_HOST || 'http://100.96.203.105:8003';

interface ExistingSubmission {
  submission_count: number;
  photo_count: number;
  feedback_message: string | null;
  qa_decision: string | null;
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
  upsSerial: string | null
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

  // Serial status
  lines.push(`🔌 ONT: ${ontSerial || 'Not scanned'}`);
  lines.push(`🔋 UPS: ${upsSerial || 'Not scanned'}`);
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
 * Generate WhatsApp acknowledgment message
 * Returns empty string if DR not found - Go bridge will skip sending
 *
 * IMPORTANT: Detects swapped serials (ONT in UPS field or vice versa) and warns immediately
 */
function generateAckMessage(
  dropNumber: string,
  found: boolean,
  photoCount: number,
  ontSerial: string | null,
  upsSerial: string | null
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

  // Serial status (with swap consideration)
  if (swapCheck.swapped) {
    // Already warned above, just show the raw values
    lines.push(`⚠️ ONT field: ${ontSerial || 'Not scanned'}`);
    lines.push(`⚠️ UPS field: ${upsSerial || 'Not scanned'}`);
  } else {
    // Normal display
    const ontLine = ontSerial
      ? `✅ ONT Serial: ${ontSerial}`
      : `⚠️ ONT Serial: Not scanned - please upload to 1Map`;
    lines.push(ontLine);

    const upsLine = upsSerial
      ? `✅ UPS Serial: ${upsSerial}`
      : `⚠️ UPS Serial: Not scanned - please upload to 1Map`;
    lines.push(upsLine);
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
    const existingSubmission = await checkExistingSubmission(dropNumber);
    const isResubmission = existingSubmission !== null;
    let submissionNumber = 1;
    let previousPhotoCount = 0;

    if (isResubmission) {
      submissionNumber = (existingSubmission.submission_count || 1) + 1;
      previousPhotoCount = existingSubmission.photo_count || 0;
      log.info('DrAcknowledgment', `RESUBMISSION detected for ${dropNumber}`, {
        previousSubmissions: existingSubmission.submission_count,
        previousPhotoCount,
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

      const response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`, {
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

    // Generate appropriate message based on whether this is a resubmission
    let ackResult: { message: string; swapped: boolean; swapDetails: string | null };

    if (isResubmission && found) {
      // Resubmission - use special template and mark for rework
      ackResult = generateResubmissionAckMessage(
        dropNumber,
        photoCount,
        previousPhotoCount,
        submissionNumber,
        ontSerial,
        upsSerial
      );
      // Mark for QA re-review and reset workflow
      await markForRework(dropNumber, photoCount);
    } else {
      // Normal first submission
      ackResult = generateAckMessage(dropNumber, found, photoCount, ontSerial, upsSerial);
    }

    const duration = Date.now() - startTime;

    if (!found) {
      log.info('DrAcknowledgment', `DR ${dropNumber} not found in 1Map - returning empty message (no ack will be sent)`);
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
      found,
      photoCount,
      ontSerial,
      upsSerial,
      message: ackResult.message,
      serialsSwapped: ackResult.swapped,
      swapDetails: ackResult.swapDetails,
      // Resubmission info
      isResubmission,
      submissionNumber,
      previousPhotoCount: isResubmission ? previousPhotoCount : null,
    });
  } catch (error) {
    log.error('DrAcknowledgment', 'Error generating acknowledgment', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method === 'POST') {
    return handlePost(req, res);
  }
  return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
}

// Public endpoint - called by Go WhatsApp Bridge
export default handler;

/**
 * API Route: /api/activate/[dropNumber]
 *
 * Purpose: Fetch a single unified review by drop number
 * Methods: GET, PATCH
 *
 * UNIFIED ARCHITECTURE (Jan 2026):
 * - GET: Reads ONLY from database - NO live API calls
 * - All data is stored in dr_photo_unified_reviews during processing
 * - For manual refresh, use POST /api/activate/[dropNumber]/refresh
 *
 * Following FibreFlow standards:
 * - Uses apiResponse helper for consistent responses
 * - Neon PostgreSQL with ep-dry-night-a9qyh4sj endpoint
 * - Proper error handling and logging
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { UnifiedReview, UpdateUnifiedReviewPayload } from '@/modules/activate/types/unified.types';
import { detectSwappedSerials, fuzzySerialMatch } from '@/modules/activate/services/qaAutoFailService';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/**
 * Data quality info returned with the response
 * UNIFIED ARCHITECTURE: These checks use data from the unified table, not live API
 */
interface DataQualityInfo {
  swapDetected: boolean;
  swapDetails: string | null;
  /** Installation mismatch: 1Map serial ≠ OES activated serial */
  installationMismatch: {
    detected: boolean;
    oneMapSerial: string | null;
    oesSerial: string | null;
    details: string;
  } | null;
}

/**
 * Check for installation mismatch between stored ONT serial and OES serial
 * UNIFIED ARCHITECTURE: Uses serial from unified table, not live API
 */
async function checkInstallationMismatch(
  dropNumber: string,
  storedOntSerial: string | null
): Promise<DataQualityInfo['installationMismatch']> {
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

    if (!oesSerial || !storedOntSerial) {
      // Can't compare if either is missing
      return null;
    }

    // Use fuzzy match to allow for minor OCR/scan differences (1-2 chars)
    const matchResult = fuzzySerialMatch(storedOntSerial, oesSerial);

    if (matchResult.isMatch) {
      // Serials match (exact or fuzzy) - no mismatch
      return null;
    }

    // Installation mismatch detected!
    return {
      detected: true,
      oneMapSerial: storedOntSerial,
      oesSerial: oesSerial,
      details: `1Map shows ${storedOntSerial} but OES activated ${oesSerial} - technician may have replaced ONT without updating 1Map`,
    };
  } catch (error) {
    log.warn(`Failed to check installation mismatch for ${dropNumber}`, { error });
    return null;
  }
}

/**
 * Check data quality using data from the unified table
 * UNIFIED ARCHITECTURE: No live API calls - uses stored data only
 */
async function checkDataQuality(
  dropNumber: string,
  review: UnifiedReview
): Promise<DataQualityInfo> {
  const qualityInfo: DataQualityInfo = {
    swapDetected: false,
    swapDetails: null,
    installationMismatch: null,
  };

  // Check for swapped serials using stored data
  const swapCheck = detectSwappedSerials(
    review.ont_serial_scanned || null,
    review.ups_serial_scanned || null
  );

  qualityInfo.swapDetected = swapCheck.swapped;
  qualityInfo.swapDetails = swapCheck.swapped ? swapCheck.details : null;

  // Check for installation mismatch using stored ONT serial
  qualityInfo.installationMismatch = await checkInstallationMismatch(
    dropNumber,
    review.ont_serial_scanned || null
  );

  return qualityInfo;
}

/**
 * GET /api/activate/[dropNumber]
 * UNIFIED ARCHITECTURE: Reads ONLY from database - NO live API calls
 * All data is stored during processing (process-new-dr.ts)
 */
async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  dropNumber: string
): Promise<void> {
  try {
    log.info(`Fetching unified review for ${dropNumber}`);

    // UNIFIED ARCHITECTURE: Read directly from dr_photo_unified_reviews
    // All data is stored here during processing - no live API calls needed
    const result = await pool.query<UnifiedReview>(
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
        wa_group_jid,
        -- Contact info from unified table (Jan 2026)
        subscriber_name,
        subscriber_phone,
        subscriber_email,
        subscriber_language,
        signup_agent,
        installer_name,
        qcontact_name,
        qcontact_phone,
        qcontact_email
      FROM dr_photo_unified_reviews
      WHERE drop_number = $1
      LIMIT 1;
      `,
      [dropNumber]
    );

    // If not found in unified table, return 404
    // NOTE: DRs should be created via process-new-dr.ts, not on-demand
    if (result.rows.length === 0) {
      log.warn(`DR not found in unified table: ${dropNumber}`);
      return apiResponse.notFound(res, 'Unified Review', dropNumber);
    }

    const review = result.rows[0];

    // Check data quality using stored data (no API calls)
    const qualityInfo = await checkDataQuality(dropNumber, review);

    log.info(`Successfully fetched unified review: ${dropNumber}`, {
      dataQuality: {
        swapDetected: qualityInfo.swapDetected,
        installationMismatch: !!qualityInfo.installationMismatch,
      },
    });

    // Return review with data quality info (no sync - all from database)
    return apiResponse.success(res, {
      ...review,
      _dataQuality: qualityInfo,
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

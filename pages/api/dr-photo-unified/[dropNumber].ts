/**
 * API Route: /api/dr-photo-unified/[dropNumber]
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
import ws from 'ws';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { UnifiedReview, UpdateUnifiedReviewPayload } from '@/modules/dr-photo-unified/types/unified.types';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

// CRITICAL: Use correct Neon endpoint (ep-dry-night-a9qyh4sj)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

/**
 * GET /api/dr-photo-unified/[dropNumber]
 * Fetch a single unified review
 */
async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  dropNumber: string
): Promise<void> {
  try {
    log.info(`Fetching unified review for ${dropNumber}`);

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
        step_08_ont_barcode,
        step_09_ups_serial,
        step_10_final_installation,
        step_11_green_lights,
        step_12_signature,
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
        updated_at
      FROM dr_photo_unified_reviews
      WHERE drop_number = $1
      LIMIT 1;
      `,
      [dropNumber]
    );

    if (result.rows.length === 0) {
      log.warn(`Unified review not found: ${dropNumber}`);
      return apiResponse.notFound(res, 'Unified Review', dropNumber);
    }

    const review = result.rows[0];

    log.info(`Successfully fetched unified review: ${dropNumber}`);
    return apiResponse.success(res, review);
  } catch (error) {
    log.error('Error fetching unified review:', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * PATCH /api/dr-photo-unified/[dropNumber]
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

    // Manual QA steps
    const stepFields: (keyof UpdateUnifiedReviewPayload)[] = [
      'step_01_house_photo',
      'step_02_cable_from_pole',
      'step_03_entry_outside',
      'step_04_entry_inside',
      'step_05_wall',
      'step_06_ont_back',
      'step_07_power_meter',
      'step_08_ont_barcode',
      'step_09_ups_serial',
      'step_10_final_installation',
      'step_11_green_lights',
      'step_12_signature',
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
export default async function handler(
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

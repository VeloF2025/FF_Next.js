/**
 * Unified Database Service
 *
 * Database operations for unified DR photo reviews
 *
 * Features:
 * - CRUD operations for unified reviews
 * - Transaction handling
 * - Query helpers
 * - Type-safe database operations
 *
 * Following FibreFlow standards:
 * - Direct SQL with Neon serverless client
 * - ep-dry-night-a9qyh4sj endpoint
 * - Comprehensive error handling
 */

import { neonConfig, Pool } from '@/lib/db-neon';
import ws from 'ws';
import { log } from '@/lib/logger';
import type { UnifiedReview, UpdateUnifiedReviewPayload } from '../types/unified.types';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

// CRITICAL: Use correct Neon endpoint (ep-dry-night-a9qyh4sj)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'process.env.DATABASE_URL',
});

/**
 * Get a unified review by drop number
 */
export async function getUnifiedReview(dropNumber: string): Promise<UnifiedReview | null> {
  try {
    const result = await pool.query(
      `
      SELECT * FROM dr_photo_unified_reviews
      WHERE drop_number = $1;
      `,
      [dropNumber]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return mapRowToUnifiedReview(result.rows[0]);
  } catch (error) {
    log.error(`Failed to get unified review for ${dropNumber}`, { error });
    throw error;
  }
}

/**
 * Get unified reviews by project
 */
export async function getUnifiedReviewsByProject(
  project: string,
  limit: number = 100,
  offset: number = 0
): Promise<UnifiedReview[]> {
  try {
    const result = await pool.query(
      `
      SELECT * FROM dr_photo_unified_reviews
      WHERE project = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3;
      `,
      [project, limit, offset]
    );

    return result.rows.map(mapRowToUnifiedReview);
  } catch (error) {
    log.error(`Failed to get unified reviews for project ${project}`, { error });
    throw error;
  }
}

/**
 * Create a new unified review
 */
export async function createUnifiedReview(
  dropNumber: string,
  project: string,
  reviewedBy?: string
): Promise<UnifiedReview> {
  try {
    const result = await pool.query(
      `
      INSERT INTO dr_photo_unified_reviews (
        drop_number,
        project,
        reviewed_by
      ) VALUES ($1, $2, $3)
      RETURNING *;
      `,
      [dropNumber, project, reviewedBy || null]
    );

    log.info(`Created unified review for ${dropNumber}`, { project });

    return mapRowToUnifiedReview(result.rows[0]);
  } catch (error) {
    log.error(`Failed to create unified review for ${dropNumber}`, { error });
    throw error;
  }
}

/**
 * Update a unified review
 */
export async function updateUnifiedReview(
  dropNumber: string,
  payload: UpdateUnifiedReviewPayload
): Promise<UnifiedReview> {
  try {
    // Build dynamic UPDATE query based on payload
    const { query, values } = buildUpdateQuery(dropNumber, payload);

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      throw new Error(`Unified review not found: ${dropNumber}`);
    }

    log.info(`Updated unified review for ${dropNumber}`, { fields: Object.keys(payload) });

    return mapRowToUnifiedReview(result.rows[0]);
  } catch (error) {
    log.error(`Failed to update unified review for ${dropNumber}`, { error });
    throw error;
  }
}

/**
 * Lock a review for editing
 */
export async function lockReview(dropNumber: string, lockedBy: string): Promise<void> {
  try {
    const result = await pool.query(
      `
      UPDATE dr_photo_unified_reviews
      SET
        locked_by = $1,
        locked_at = NOW(),
        updated_at = NOW()
      WHERE drop_number = $2
        AND (locked_by IS NULL OR locked_by = $1);
      `,
      [lockedBy, dropNumber]
    );

    if (result.rowCount === 0) {
      // Check if review exists or is locked by someone else
      const existing = await getUnifiedReview(dropNumber);

      if (!existing) {
        throw new Error(`Unified review not found: ${dropNumber}`);
      }

      if (existing.locked_by && existing.locked_by !== lockedBy) {
        throw new Error(`Review is locked by ${existing.locked_by}`);
      }
    }

    log.info(`Locked review ${dropNumber}`, { lockedBy });
  } catch (error) {
    log.error(`Failed to lock review ${dropNumber}`, { error });
    throw error;
  }
}

/**
 * Unlock a review
 */
export async function unlockReview(dropNumber: string, lockedBy?: string): Promise<void> {
  try {
    const query = lockedBy
      ? `UPDATE dr_photo_unified_reviews SET locked_by = NULL, locked_at = NULL, updated_at = NOW() WHERE drop_number = $1 AND locked_by = $2;`
      : `UPDATE dr_photo_unified_reviews SET locked_by = NULL, locked_at = NULL, updated_at = NOW() WHERE drop_number = $1;`;

    const values = lockedBy ? [dropNumber, lockedBy] : [dropNumber];

    await pool.query(query, values);

    log.info(`Unlocked review ${dropNumber}`, { lockedBy });
  } catch (error) {
    log.error(`Failed to unlock review ${dropNumber}`, { error });
    throw error;
  }
}

/**
 * Delete a unified review
 */
export async function deleteUnifiedReview(dropNumber: string): Promise<void> {
  try {
    await pool.query(
      `
      DELETE FROM dr_photo_unified_reviews
      WHERE drop_number = $1;
      `,
      [dropNumber]
    );

    log.info(`Deleted unified review for ${dropNumber}`);
  } catch (error) {
    log.error(`Failed to delete unified review for ${dropNumber}`, { error });
    throw error;
  }
}

/**
 * Get reviews pending AI evaluation
 */
export async function getReviewsPendingEvaluation(limit: number = 10): Promise<UnifiedReview[]> {
  try {
    const result = await pool.query(
      `
      SELECT * FROM dr_photo_unified_reviews
      WHERE ai_evaluation_status IS NULL
        OR ai_evaluation_status = 'pending'
      ORDER BY created_at ASC
      LIMIT $1;
      `,
      [limit]
    );

    return result.rows.map(mapRowToUnifiedReview);
  } catch (error) {
    log.error('Failed to get reviews pending evaluation', { error });
    throw error;
  }
}

/**
 * Get reviews with feedback not sent
 */
export async function getReviewsWithoutFeedback(limit: number = 10): Promise<UnifiedReview[]> {
  try {
    const result = await pool.query(
      `
      SELECT * FROM dr_photo_unified_reviews
      WHERE feedback_sent = false
        AND (ai_evaluation_status = 'completed' OR incorrect_steps IS NOT NULL)
      ORDER BY created_at ASC
      LIMIT $1;
      `,
      [limit]
    );

    return result.rows.map(mapRowToUnifiedReview);
  } catch (error) {
    log.error('Failed to get reviews without feedback', { error });
    throw error;
  }
}

/**
 * Get review statistics for a project
 */
export async function getProjectStatistics(project: string): Promise<{
  total: number;
  aiEvaluated: number;
  aiPassed: number;
  aiFailed: number;
  feedbackSent: number;
  averageScore: number;
}> {
  try {
    const result = await pool.query(
      `
      SELECT
        COUNT(*) as total,
        COUNT(ai_evaluation_status) FILTER (WHERE ai_evaluation_status = 'completed') as ai_evaluated,
        COUNT(ai_overall_status) FILTER (WHERE ai_overall_status = 'PASS') as ai_passed,
        COUNT(ai_overall_status) FILTER (WHERE ai_overall_status = 'FAIL') as ai_failed,
        COUNT(*) FILTER (WHERE feedback_sent = true) as feedback_sent,
        AVG(ai_average_score) as average_score
      FROM dr_photo_unified_reviews
      WHERE project = $1;
      `,
      [project]
    );

    const row = result.rows[0];

    return {
      total: parseInt(row.total) || 0,
      aiEvaluated: parseInt(row.ai_evaluated) || 0,
      aiPassed: parseInt(row.ai_passed) || 0,
      aiFailed: parseInt(row.ai_failed) || 0,
      feedbackSent: parseInt(row.feedback_sent) || 0,
      averageScore: parseFloat(row.average_score) || 0,
    };
  } catch (error) {
    log.error(`Failed to get statistics for project ${project}`, { error });
    throw error;
  }
}

/**
 * Build dynamic UPDATE query based on payload
 */
function buildUpdateQuery(
  dropNumber: string,
  payload: UpdateUnifiedReviewPayload
): { query: string; values: any[] } {
  const setClauses: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  // Add each field from payload to SET clause
  Object.entries(payload).forEach(([key, value]) => {
    setClauses.push(`${key} = $${paramIndex}`);
    values.push(value);
    paramIndex++;
  });

  // Always update updated_at
  setClauses.push(`updated_at = NOW()`);

  // Add dropNumber as last parameter
  values.push(dropNumber);

  const query = `
    UPDATE dr_photo_unified_reviews
    SET ${setClauses.join(', ')}
    WHERE drop_number = $${paramIndex}
    RETURNING *;
  `;

  return { query, values };
}

/**
 * Map database row to UnifiedReview type
 */
function mapRowToUnifiedReview(row: any): UnifiedReview {
  return {
    id: row.id,
    drop_number: row.drop_number,
    project: row.project,

    // Photo metadata
    photo_source: row.photo_source,
    photo_count: row.photo_count,
    photos_metadata: row.photos_metadata || [],

    // 10 unified QA steps (ONT/UPS barcodes are scanned, not photographed)
    step_01_house_photo: row.step_01_house_photo,
    step_02_cable_from_pole: row.step_02_cable_from_pole,
    step_03_entry_outside: row.step_03_entry_outside,
    step_04_entry_inside: row.step_04_entry_inside,
    step_05_wall: row.step_05_wall,
    step_06_ont_back: row.step_06_ont_back,
    step_07_power_meter: row.step_07_power_meter,
    step_08_final_installation: row.step_08_final_installation,
    step_09_green_lights: row.step_09_green_lights,
    step_10_signature: row.step_10_signature,

    // Incorrect tracking
    incorrect_steps: row.incorrect_steps || [],
    incorrect_comments: row.incorrect_comments || {},

    // AI evaluation results
    ai_evaluation_status: row.ai_evaluation_status,
    ai_overall_status: row.ai_overall_status,
    ai_average_score: row.ai_average_score,
    ai_step_results: row.ai_step_results || [],
    ai_markdown_report: row.ai_markdown_report,
    ai_evaluated_at: row.ai_evaluated_at,

    // Serial scanning
    ont_serial_scanned: row.ont_serial_scanned,
    ups_serial_scanned: row.ups_serial_scanned,

    // Locking
    locked_by: row.locked_by,
    locked_at: row.locked_at,

    // WhatsApp feedback
    feedback_sent: row.feedback_sent,
    feedback_message: row.feedback_message,
    feedback_sent_at: row.feedback_sent_at,

    // Metadata
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Get database pool for advanced queries
 * Use sparingly - prefer typed service methods
 */
export function getPool(): Pool {
  return pool;
}

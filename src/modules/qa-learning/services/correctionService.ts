/**
 * Correction Service
 *
 * Purpose: Store and retrieve human corrections to VLM categorizations
 * Used for: Building few-shot examples for prompt enhancement
 *
 * WORKING: Phase 1 implementation
 */

import { log } from '@/lib/logger';
import db from '@/lib/db';
import {
  WorkflowType,
  CorrectionRecord,
  RecordCorrectionInput,
  CorrectionRecordRow,
  CorrectionStats,
  rowToCorrectionRecord,
} from '../types/learning.types';

// ============================================================================
// ERROR HANDLING
// ============================================================================

export class CorrectionServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'CorrectionServiceError';
  }
}

// ============================================================================
// RECORD CORRECTIONS
// ============================================================================

/**
 * Record a human correction to VLM categorization
 *
 * Called when a human overrides VLM's prediction in the approval flow.
 * Only records corrections where human disagreed with VLM (not agreements).
 *
 * @param input - Correction details
 * @returns Created correction record
 */
export async function recordCorrection(input: RecordCorrectionInput): Promise<CorrectionRecord> {
  const startTime = Date.now();

  // Don't record if human agreed with VLM
  if (input.vlmPredictedStep === input.correctStep) {
    log.debug('Skipping correction - human agreed with VLM', undefined, 'CorrectionService');
    throw new CorrectionServiceError(
      'Cannot record correction when VLM was correct',
      'NO_CORRECTION_NEEDED'
    );
  }

  try {
    const result = await db.query<CorrectionRecordRow>(
      `INSERT INTO qa_correction_examples (
        workflow_type,
        photo_filename,
        photo_description,
        vlm_predicted_step,
        vlm_predicted_category,
        vlm_confidence,
        vlm_reasoning,
        correct_step,
        correct_category,
        correction_reason,
        corrected_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        input.workflowType,
        input.photoFilename,
        input.photoDescription || null,
        input.vlmPredictedStep,
        input.vlmPredictedCategory,
        input.vlmConfidence,
        input.vlmReasoning || null,
        input.correctStep,
        input.correctCategory,
        input.correctionReason || null,
        input.correctedBy,
      ]
    );

    const correction = rowToCorrectionRecord(result.rows[0]!);
    const duration = Date.now() - startTime;

    log.info('CorrectionService', {
      action: 'recordCorrection',
      workflowType: input.workflowType,
      photoFilename: input.photoFilename,
      vlmStep: input.vlmPredictedStep,
      correctStep: input.correctStep,
      duration,
    });

    return correction;
  } catch (error) {
    log.error('CorrectionService', {
      action: 'recordCorrection',
      error: error instanceof Error ? error.message : String(error),
      input,
    });

    throw new CorrectionServiceError(
      `Failed to record correction: ${error instanceof Error ? error.message : String(error)}`,
      'DB_INSERT_FAILED',
      error
    );
  }
}

// ============================================================================
// RETRIEVE CORRECTIONS
// ============================================================================

/**
 * Get all corrections for a workflow type
 *
 * @param workflowType - Workflow to get corrections for
 * @param options - Query options
 * @returns Array of correction records
 */
export async function getCorrections(
  workflowType: WorkflowType,
  options: {
    limit?: number;
    offset?: number;
    canonicalOnly?: boolean;
    minConfidence?: number;
  } = {}
): Promise<CorrectionRecord[]> {
  const { limit = 100, offset = 0, canonicalOnly = false, minConfidence } = options;

  try {
    let query = `
      SELECT * FROM qa_correction_examples
      WHERE workflow_type = $1
    `;
    const params: (string | number | boolean)[] = [workflowType];
    let paramIndex = 2;

    if (canonicalOnly) {
      query += ` AND is_canonical = true`;
    }

    if (minConfidence !== undefined) {
      query += ` AND vlm_confidence >= $${paramIndex}`;
      params.push(minConfidence);
      paramIndex++;
    }

    query += ` ORDER BY is_canonical DESC, reviewed_count DESC, created_at DESC`;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await db.query<CorrectionRecordRow>(query, params);

    return result.rows.map(rowToCorrectionRecord);
  } catch (error) {
    log.error('CorrectionService', {
      action: 'getCorrections',
      workflowType,
      error: error instanceof Error ? error.message : String(error),
    });

    throw new CorrectionServiceError(
      `Failed to get corrections: ${error instanceof Error ? error.message : String(error)}`,
      'DB_QUERY_FAILED',
      error
    );
  }
}

/**
 * Get corrections for a specific VLM-predicted step
 *
 * Useful for finding examples where VLM wrongly predicted a particular step.
 *
 * @param workflowType - Workflow type
 * @param vlmPredictedStep - Step that VLM incorrectly predicted
 * @param limit - Maximum results
 */
export async function getCorrectionsForStep(
  workflowType: WorkflowType,
  vlmPredictedStep: number,
  limit = 10
): Promise<CorrectionRecord[]> {
  try {
    const result = await db.query<CorrectionRecordRow>(
      `SELECT * FROM qa_correction_examples
       WHERE workflow_type = $1
         AND vlm_predicted_step = $2
         AND correct_step != $2
       ORDER BY is_canonical DESC, vlm_confidence DESC, reviewed_count DESC
       LIMIT $3`,
      [workflowType, vlmPredictedStep, limit]
    );

    return result.rows.map(rowToCorrectionRecord);
  } catch (error) {
    log.error('CorrectionService', {
      action: 'getCorrectionsForStep',
      workflowType,
      vlmPredictedStep,
      error: error instanceof Error ? error.message : String(error),
    });

    throw new CorrectionServiceError(
      `Failed to get corrections for step: ${error instanceof Error ? error.message : String(error)}`,
      'DB_QUERY_FAILED',
      error
    );
  }
}

/**
 * Get corrections for confusion pairs (steps commonly confused by VLM)
 *
 * @param workflowType - Workflow type
 * @param confusionPairs - Array of [stepA, stepB] pairs
 * @param limitPerPair - Maximum examples per confusion pair
 */
export async function getConfusionPairCorrections(
  workflowType: WorkflowType,
  confusionPairs: Array<[number, number]>,
  limitPerPair = 2
): Promise<CorrectionRecord[]> {
  if (confusionPairs.length === 0) {
    return [];
  }

  try {
    // Build WHERE clause for confusion pairs
    const pairConditions = confusionPairs
      .map(
        ([_a, _b], i) =>
          `((vlm_predicted_step = $${i * 2 + 2} AND correct_step = $${i * 2 + 3}) OR ` +
          `(vlm_predicted_step = $${i * 2 + 3} AND correct_step = $${i * 2 + 2}))`
      )
      .join(' OR ');

    const params: (string | number)[] = [workflowType];
    for (const [a, b] of confusionPairs) {
      params.push(a, b);
    }

    const result = await db.query<CorrectionRecordRow>(
      `SELECT * FROM qa_correction_examples
       WHERE workflow_type = $1
         AND (${pairConditions})
       ORDER BY is_canonical DESC, reviewed_count DESC, vlm_confidence DESC
       LIMIT $${params.length + 1}`,
      [...params, limitPerPair * confusionPairs.length]
    );

    return result.rows.map(rowToCorrectionRecord);
  } catch (error) {
    log.error('CorrectionService', {
      action: 'getConfusionPairCorrections',
      workflowType,
      confusionPairs,
      error: error instanceof Error ? error.message : String(error),
    });

    throw new CorrectionServiceError(
      `Failed to get confusion pair corrections: ${error instanceof Error ? error.message : String(error)}`,
      'DB_QUERY_FAILED',
      error
    );
  }
}

// ============================================================================
// CANONICAL MANAGEMENT
// ============================================================================

/**
 * Mark a correction as canonical (high-quality curated example)
 *
 * Canonical examples are prioritized in few-shot selection.
 *
 * @param correctionId - ID of correction to mark
 * @param isCanonical - Whether to mark as canonical
 */
export async function markAsCanonical(
  correctionId: string,
  isCanonical: boolean
): Promise<CorrectionRecord | null> {
  try {
    const result = await db.query<CorrectionRecordRow>(
      `UPDATE qa_correction_examples
       SET is_canonical = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [isCanonical, correctionId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    log.info('CorrectionService', {
      action: 'markAsCanonical',
      correctionId,
      isCanonical,
    });

    return rowToCorrectionRecord(result.rows[0]!);
  } catch (error) {
    log.error('CorrectionService', {
      action: 'markAsCanonical',
      correctionId,
      error: error instanceof Error ? error.message : String(error),
    });

    throw new CorrectionServiceError(
      `Failed to mark as canonical: ${error instanceof Error ? error.message : String(error)}`,
      'DB_UPDATE_FAILED',
      error
    );
  }
}

/**
 * Increment review count (when multiple reviewers agree on a correction)
 *
 * @param correctionId - ID of correction
 */
export async function incrementReviewCount(correctionId: string): Promise<CorrectionRecord | null> {
  try {
    const result = await db.query<CorrectionRecordRow>(
      `UPDATE qa_correction_examples
       SET reviewed_count = reviewed_count + 1, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [correctionId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return rowToCorrectionRecord(result.rows[0]!);
  } catch (error) {
    log.error('CorrectionService', {
      action: 'incrementReviewCount',
      correctionId,
      error: error instanceof Error ? error.message : String(error),
    });

    throw new CorrectionServiceError(
      `Failed to increment review count: ${error instanceof Error ? error.message : String(error)}`,
      'DB_UPDATE_FAILED',
      error
    );
  }
}

// ============================================================================
// STATISTICS
// ============================================================================

/**
 * Get correction statistics for a workflow
 *
 * @param workflowType - Workflow type
 */
export async function getCorrectionStats(workflowType: WorkflowType): Promise<CorrectionStats> {
  try {
    // Get counts
    const countsResult = await db.query<{
      total: string;
      canonical: string;
      recent: string;
    }>(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_canonical = true) as canonical,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as recent
       FROM qa_correction_examples
       WHERE workflow_type = $1`,
      [workflowType]
    );

    // Get top confused step pairs
    const confusedResult = await db.query<{
      vlm_step: number;
      correct_step: number;
      count: string;
    }>(
      `SELECT
        vlm_predicted_step as vlm_step,
        correct_step,
        COUNT(*) as count
       FROM qa_correction_examples
       WHERE workflow_type = $1
       GROUP BY vlm_predicted_step, correct_step
       ORDER BY count DESC
       LIMIT 5`,
      [workflowType]
    );

    const counts = countsResult.rows[0] || { total: '0', canonical: '0', recent: '0' };

    return {
      workflowType,
      totalCorrections: parseInt(counts.total, 10),
      canonicalCount: parseInt(counts.canonical, 10),
      recentCorrections: parseInt(counts.recent, 10),
      topConfusedSteps: confusedResult.rows.map((row) => ({
        vlmStep: row.vlm_step,
        correctStep: row.correct_step,
        count: parseInt(row.count, 10),
      })),
    };
  } catch (error) {
    log.error('CorrectionService', {
      action: 'getCorrectionStats',
      workflowType,
      error: error instanceof Error ? error.message : String(error),
    });

    throw new CorrectionServiceError(
      `Failed to get correction stats: ${error instanceof Error ? error.message : String(error)}`,
      'DB_QUERY_FAILED',
      error
    );
  }
}

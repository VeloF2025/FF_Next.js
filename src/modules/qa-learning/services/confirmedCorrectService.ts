/**
 * Confirmed Correct Service
 *
 * Stores photos from DRs where the human operator accepted AI QA
 * without changes. These serve as positive few-shot examples.
 */

import { log } from '@/lib/logger';
import db from '@/lib/db';
import type {
  WorkflowType,
  RecordConfirmedCorrectInput,
  ConfirmedCorrectRecord,
  ConfirmedCorrectRow,
} from '../types/learning.types';
import { rowToConfirmedCorrect } from '../types/learning.types';

// ============================================================================
// ERROR CLASS
// ============================================================================

export class ConfirmedCorrectServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'ConfirmedCorrectServiceError';
  }
}

// ============================================================================
// WRITE
// ============================================================================

/**
 * Save a batch of confirmed-correct photos from a single DR.
 * Uses ON CONFLICT to increment reviewed_count on re-confirmation.
 * Returns count of rows inserted/updated.
 */
export async function recordConfirmedCorrectBatch(
  inputs: RecordConfirmedCorrectInput[]
): Promise<number> {
  if (inputs.length === 0) return 0;

  // Build multi-row VALUES clause
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const input of inputs) {
    placeholders.push(
      `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8})`
    );
    values.push(
      input.workflowType,
      input.dropNumber,
      input.photoFilename,
      input.photoDescription || null,
      input.vlmPredictedStep,
      input.vlmPredictedCategory,
      input.vlmConfidence,
      input.vlmReasoning || null,
      input.confirmedBy
    );
    idx += 9;
  }

  const result = await db.query(
    `INSERT INTO qa_confirmed_correct (
       workflow_type, drop_number, photo_filename, photo_description,
       vlm_predicted_step, vlm_predicted_category, vlm_confidence,
       vlm_reasoning, confirmed_by
     ) VALUES ${placeholders.join(', ')}
     ON CONFLICT (workflow_type, photo_filename, drop_number)
     DO UPDATE SET reviewed_count = qa_confirmed_correct.reviewed_count + 1,
                   updated_at = NOW()`,
    values
  );

  log.info('Saved confirmed-correct examples', {
    action: 'recordConfirmedCorrectBatch',
    count: inputs.length,
    dropNumber: inputs[0]?.dropNumber,
    rowCount: result.rowCount,
  }, 'ConfirmedCorrectService');

  return result.rowCount ?? inputs.length;
}

// ============================================================================
// READ
// ============================================================================

/**
 * Quick existence check — avoids heavier queries when table is empty
 */
export async function hasConfirmedCorrect(workflowType: WorkflowType): Promise<boolean> {
  try {
    const result = await db.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM qa_confirmed_correct WHERE workflow_type = $1) as exists`,
      [workflowType]
    );
    return result.rows[0]?.exists || false;
  } catch {
    return false;
  }
}

/**
 * Get confirmed-correct records for prompt injection.
 * Prioritises canonical, then highest confidence, then most reviewed.
 */
export async function getConfirmedCorrect(
  workflowType: WorkflowType,
  options: { limit?: number; minConfidence?: number; canonicalOnly?: boolean } = {}
): Promise<ConfirmedCorrectRecord[]> {
  const { limit = 10, minConfidence = 0.0, canonicalOnly = false } = options;

  let query = `
    SELECT * FROM qa_confirmed_correct
    WHERE workflow_type = $1
      AND vlm_confidence >= $2
  `;
  const params: (string | number | boolean)[] = [workflowType, minConfidence];

  if (canonicalOnly) {
    query += ` AND is_canonical = true`;
  }

  query += ` ORDER BY is_canonical DESC, vlm_confidence DESC, reviewed_count DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await db.query<ConfirmedCorrectRow>(query, params);
  return result.rows.map(rowToConfirmedCorrect);
}

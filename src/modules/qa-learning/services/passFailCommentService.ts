/**
 * Pass/Fail + Comment Correction Service
 *
 * Records human overrides of VLM pass/fail decisions and auto-generated
 * comments. Data feeds future auto-QA few-shot context so the system
 * incrementally matches human judgment on tone, specificity, and disposition.
 */

import { log } from '@/lib/logger';
import db from '@/lib/db';
import type { WorkflowType } from '../types/learning.types';

// ============================================================================
// TYPES
// ============================================================================

export type QaDecisionValue = 'PASS' | 'FAIL';

export interface PassFailCorrectionInput {
  workflowType: WorkflowType;
  dropNumber?: string | null;
  photoFilename: string;
  photoDescription?: string | null;
  step: number;
  stepLabel?: string | null;

  vlmDecision: QaDecisionValue;
  vlmConfidence: number;
  vlmReasoning?: string | null;
  vlmComment?: string | null;

  correctDecision: QaDecisionValue;
  correctionReason?: string | null;

  correctedBy: string;
}

export interface CommentCorrectionInput {
  workflowType: WorkflowType;
  dropNumber?: string | null;
  photoFilename: string;
  photoDescription?: string | null;
  step: number;
  stepLabel?: string | null;
  decision: QaDecisionValue;
  vlmConfidence?: number | null;
  vlmReasoning?: string | null;

  vlmComment: string;
  correctedComment: string;

  correctedBy: string;
}

export interface PassFailCorrectionRecord {
  id: string;
  workflowType: WorkflowType;
  dropNumber: string | null;
  photoFilename: string;
  step: number;
  vlmDecision: QaDecisionValue;
  correctDecision: QaDecisionValue;
  createdAt: Date;
}

export interface CommentCorrectionRecord {
  id: string;
  workflowType: WorkflowType;
  dropNumber: string | null;
  photoFilename: string;
  step: number;
  decision: QaDecisionValue;
  vlmComment: string;
  correctedComment: string;
  createdAt: Date;
}

export class PassFailCommentServiceError extends Error {
  constructor(message: string, public readonly code: string, public readonly details?: unknown) {
    super(message);
    this.name = 'PassFailCommentServiceError';
  }
}

// ============================================================================
// RECORD
// ============================================================================

export async function recordPassFailCorrection(
  input: PassFailCorrectionInput
): Promise<PassFailCorrectionRecord> {
  if (input.vlmDecision === input.correctDecision) {
    throw new PassFailCommentServiceError(
      'Cannot record correction when VLM decision matches human decision',
      'NO_CORRECTION_NEEDED'
    );
  }

  try {
    const result = await db.query<{
      id: string;
      workflow_type: string;
      drop_number: string | null;
      photo_filename: string;
      step: number;
      vlm_decision: string;
      correct_decision: string;
      created_at: Date;
    }>(
      `INSERT INTO qa_passfail_corrections (
        workflow_type, drop_number, photo_filename, photo_description,
        step, step_label,
        vlm_decision, vlm_confidence, vlm_reasoning, vlm_comment,
        correct_decision, correction_reason,
        corrected_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id, workflow_type, drop_number, photo_filename, step,
                vlm_decision, correct_decision, created_at`,
      [
        input.workflowType,
        input.dropNumber ?? null,
        input.photoFilename,
        input.photoDescription ?? null,
        input.step,
        input.stepLabel ?? null,
        input.vlmDecision,
        input.vlmConfidence,
        input.vlmReasoning ?? null,
        input.vlmComment ?? null,
        input.correctDecision,
        input.correctionReason ?? null,
        input.correctedBy,
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new PassFailCommentServiceError('INSERT returned no row', 'DB_INSERT_FAILED');
    }
    log.info('PassFailCorrection', {
      action: 'recorded',
      workflowType: input.workflowType,
      photo: input.photoFilename,
      from: input.vlmDecision,
      to: input.correctDecision,
    });

    return {
      id: row.id,
      workflowType: row.workflow_type as WorkflowType,
      dropNumber: row.drop_number,
      photoFilename: row.photo_filename,
      step: row.step,
      vlmDecision: row.vlm_decision as QaDecisionValue,
      correctDecision: row.correct_decision as QaDecisionValue,
      createdAt: row.created_at,
    };
  } catch (error) {
    log.error('PassFailCorrection', {
      action: 'recordFailed',
      error: error instanceof Error ? error.message : String(error),
      photo: input.photoFilename,
    });
    throw new PassFailCommentServiceError(
      `Failed to record pass/fail correction: ${error instanceof Error ? error.message : String(error)}`,
      'DB_INSERT_FAILED',
      error
    );
  }
}

export async function recordCommentCorrection(
  input: CommentCorrectionInput
): Promise<CommentCorrectionRecord> {
  if (input.vlmComment.trim() === input.correctedComment.trim()) {
    throw new PassFailCommentServiceError(
      'Cannot record correction when comment is unchanged',
      'NO_CORRECTION_NEEDED'
    );
  }

  try {
    const result = await db.query<{
      id: string;
      workflow_type: string;
      drop_number: string | null;
      photo_filename: string;
      step: number;
      decision: string;
      vlm_comment: string;
      corrected_comment: string;
      created_at: Date;
    }>(
      `INSERT INTO qa_comment_corrections (
        workflow_type, drop_number, photo_filename, photo_description,
        step, step_label, decision, vlm_confidence, vlm_reasoning,
        vlm_comment, corrected_comment, corrected_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id, workflow_type, drop_number, photo_filename, step,
                decision, vlm_comment, corrected_comment, created_at`,
      [
        input.workflowType,
        input.dropNumber ?? null,
        input.photoFilename,
        input.photoDescription ?? null,
        input.step,
        input.stepLabel ?? null,
        input.decision,
        input.vlmConfidence ?? null,
        input.vlmReasoning ?? null,
        input.vlmComment,
        input.correctedComment,
        input.correctedBy,
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new PassFailCommentServiceError('INSERT returned no row', 'DB_INSERT_FAILED');
    }
    log.info('CommentCorrection', {
      action: 'recorded',
      workflowType: input.workflowType,
      photo: input.photoFilename,
      step: input.step,
    });

    return {
      id: row.id,
      workflowType: row.workflow_type as WorkflowType,
      dropNumber: row.drop_number,
      photoFilename: row.photo_filename,
      step: row.step,
      decision: row.decision as QaDecisionValue,
      vlmComment: row.vlm_comment,
      correctedComment: row.corrected_comment,
      createdAt: row.created_at,
    };
  } catch (error) {
    log.error('CommentCorrection', {
      action: 'recordFailed',
      error: error instanceof Error ? error.message : String(error),
      photo: input.photoFilename,
    });
    throw new PassFailCommentServiceError(
      `Failed to record comment correction: ${error instanceof Error ? error.message : String(error)}`,
      'DB_INSERT_FAILED',
      error
    );
  }
}

// ============================================================================
// RETRIEVE (minimal — for future few-shot injection)
// Split to passFailCommentQuery.ts to keep this file under 300 lines.
// Re-exported here so external callers continue to work unchanged.
// ============================================================================

export {
  getPassFailCorrectionsForStep,
  getCommentCorrectionsForStep,
} from './passFailCommentQuery';

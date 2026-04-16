/**
 * Pass/Fail + Comment Correction Query Service
 *
 * Retrieval helpers for pass/fail and comment correction records.
 * Intended for future few-shot injection into VLM auto-QA prompts.
 *
 * Split from passFailCommentService.ts to keep that file under 300 lines.
 */

import db from '@/lib/db';
import type {
  WorkflowType,
  QaDecisionValue,
  PassFailCorrectionRecord,
  CommentCorrectionRecord,
} from '../types/learning.types';

// ============================================================================
// RETRIEVE (minimal — for future few-shot injection)
// ============================================================================

export async function getPassFailCorrectionsForStep(
  workflowType: WorkflowType,
  step: number,
  limit = 10
): Promise<PassFailCorrectionRecord[]> {
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
    `SELECT id, workflow_type, drop_number, photo_filename, step,
            vlm_decision, correct_decision, created_at
     FROM qa_passfail_corrections
     WHERE workflow_type = $1 AND step = $2
     ORDER BY is_canonical DESC, reviewed_count DESC, created_at DESC
     LIMIT $3`,
    [workflowType, step, limit]
  );
  return result.rows.map((row) => ({
    id: row.id,
    workflowType: row.workflow_type as WorkflowType,
    dropNumber: row.drop_number,
    photoFilename: row.photo_filename,
    step: row.step,
    vlmDecision: row.vlm_decision as QaDecisionValue,
    correctDecision: row.correct_decision as QaDecisionValue,
    createdAt: row.created_at,
  }));
}

export async function getCommentCorrectionsForStep(
  workflowType: WorkflowType,
  step: number,
  decision: QaDecisionValue,
  limit = 10
): Promise<CommentCorrectionRecord[]> {
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
    `SELECT id, workflow_type, drop_number, photo_filename, step,
            decision, vlm_comment, corrected_comment, created_at
     FROM qa_comment_corrections
     WHERE workflow_type = $1 AND step = $2 AND decision = $3
     ORDER BY is_canonical DESC, reviewed_count DESC, created_at DESC
     LIMIT $4`,
    [workflowType, step, decision, limit]
  );
  return result.rows.map((row) => ({
    id: row.id,
    workflowType: row.workflow_type as WorkflowType,
    dropNumber: row.drop_number,
    photoFilename: row.photo_filename,
    step: row.step,
    decision: row.decision as QaDecisionValue,
    vlmComment: row.vlm_comment,
    correctedComment: row.corrected_comment,
    createdAt: row.created_at,
  }));
}

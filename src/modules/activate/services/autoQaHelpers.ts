/**
 * Auto-QA Helpers
 *
 * Extracted from autoQaProcessor.ts for file-size compliance.
 * Contains persistence and result-building utilities.
 */

import pool from '@/lib/db';
import {
  evaluateAutoFail,
  getFailReasonDescription,
  checkStepCoverage,
} from './qaAutoFailService';
import type { AutoQaResults } from './autoQaCommentGenerator';
import type { QaDecision } from '../types/unified.types';
import type { AutoQaProcessResult } from './autoQaProcessor';

/**
 * Persist auto-QA results to the database
 */
export async function persistAutoQaResults(
  dropNumber: string,
  decision: QaDecision,
  autoFailResult: ReturnType<typeof evaluateAutoFail>,
  autoQaResults: AutoQaResults,
  stepCoverage: ReturnType<typeof checkStepCoverage>
): Promise<void> {
  const reasons = decision === 'PASS' ? [] : autoFailResult.reasons;
  const reasonDescriptions = reasons.map((r) => ({ check: r, status: 'fail', message: getFailReasonDescription(r) }));

  // Compute step booleans from coverage
  const stepBooleans = Array.from({ length: 12 }, (_, i) =>
    stepCoverage.covered.includes(i + 1)
  );

  await pool.query(
    `UPDATE dr_photo_unified_reviews
     SET
       auto_qa_processed = true,
       auto_qa_processed_at = NOW(),
       auto_qa_results = $1::jsonb,
       qa_decision = $2,
       qa_decision_reasons = $3::jsonb,
       qa_decision_at = NOW(),
       qa_decision_by = 'system:auto-qa',
       qa_phase = 'feedback',
       human_review_status = 'pending_hitl',
       vlm_qa_status = 'completed',
       step_01_house_photo = $5,
       step_02_cable_from_pole = $6,
       step_03_entry_outside = $7,
       step_04_entry_inside = $8,
       step_05_wall = $9,
       step_06_ont_back = $10,
       step_07_power_meter = $11,
       step_08_final_installation = $12,
       step_09_green_lights = $13,
       step_10_signature = $14,
       updated_at = NOW()
     WHERE drop_number = $4`,
    [
      JSON.stringify(autoQaResults),
      decision,
      JSON.stringify(reasonDescriptions),
      dropNumber,
      stepBooleans[0], stepBooleans[1], stepBooleans[2], stepBooleans[3], stepBooleans[4],
      stepBooleans[5], stepBooleans[6], stepBooleans[7], stepBooleans[8], stepBooleans[9],
    ]
  );
}

/**
 * Build a standardized AutoQaProcessResult with defaults
 */
export function makeResult(
  dropNumber: string,
  startTime: number,
  overrides: Partial<AutoQaProcessResult>
): AutoQaProcessResult {
  return {
    dropNumber,
    success: false,
    decision: null,
    skipped: false,
    photoCount: 0,
    passed: 0,
    failed: 0,
    processingTimeMs: Date.now() - startTime,
    ...overrides,
  };
}

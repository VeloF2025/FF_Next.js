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
  stepCoverage: ReturnType<typeof checkStepCoverage>,
  discardedPhotos?: Array<{ filename: string; originalStep: number; reason: string }>
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
       step_11_dome_joint_open = $15,
       step_12_dome_joint_closed = $16,
       updated_at = NOW()
     WHERE drop_number = $4`,
    [
      JSON.stringify(autoQaResults),
      decision,
      JSON.stringify(reasonDescriptions),
      dropNumber,
      stepBooleans[0], stepBooleans[1], stepBooleans[2], stepBooleans[3], stepBooleans[4],
      stepBooleans[5], stepBooleans[6], stepBooleans[7], stepBooleans[8], stepBooleans[9],
      stepBooleans[10], stepBooleans[11],
    ]
  );

  // Patch photos_metadata and vlm_categorization_results for discarded duplicates
  // so the feedback UI shows the corrected steps
  if (discardedPhotos && discardedPhotos.length > 0) {
    const discardMap = new Map(discardedPhotos.map((d) => [d.filename, d]));

    // Update photos_metadata
    const metaResult = await pool.query(
      `SELECT photos_metadata, vlm_categorization_results
       FROM dr_photo_unified_reviews WHERE drop_number = $1`,
      [dropNumber]
    );

    if (metaResult.rows.length > 0) {
      const row = metaResult.rows[0];
      const photos = row.photos_metadata || [];
      const vlmResults = row.vlm_categorization_results || [];

      let patchNeeded = false;

      for (let i = 0; i < photos.length; i++) {
        const discard = discardMap.get(photos[i].filename);
        if (discard) {
          photos[i] = { ...photos[i], step: 0 };
          patchNeeded = true;
        }
      }

      for (let i = 0; i < vlmResults.length; i++) {
        const discard = discardMap.get(vlmResults[i].photo_filename);
        if (discard) {
          vlmResults[i] = {
            ...vlmResults[i],
            human_override_step: 0,
            human_override_reason: discard.reason,
          };
          patchNeeded = true;
        }
      }

      if (patchNeeded) {
        await pool.query(
          `UPDATE dr_photo_unified_reviews
           SET photos_metadata = $1, vlm_categorization_results = $2, updated_at = NOW()
           WHERE drop_number = $3`,
          [JSON.stringify(photos), JSON.stringify(vlmResults), dropNumber]
        );
      }
    }
  }
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

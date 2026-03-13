/**
 * Auto-QA Processor
 *
 * Programmatically runs QA wizard phases 1-4 for eligible DRs,
 * then parks them at phase 5 (feedback) for human review.
 *
 * Eligible DRs: received 30+ min ago, photos categorized, data extracted,
 * not yet QA'd, and no human_required tier photos.
 */

import pool from '@/lib/db';
import { log } from '@/lib/logger';
import {
  checkPrerequisites,
  checkStepCoverage,
  validatePowerMeter,
  validateSerialCrossReference,
  evaluateAutoFail,
  type DrValidationData,
} from './qaAutoFailService';
import {
  getStepAccuracy,
  assignTiers,
  buildSummary,
} from './autoApprovalService';
import {
  generatePhotoComment,
  generateMissingStepComment,
  generateFeedbackMessage,
  type AutoQaPhotoResult,
  type AutoQaResults,
} from './autoQaCommentGenerator';
import { logActivity } from './activityLogService';
import { persistAutoQaResults, makeResult } from './autoQaHelpers';
import type { VlmCategorizationResult, QaDecision } from '../types/unified.types';

// ============================================================================
// TYPES
// ============================================================================

export interface EligibleDR {
  drop_number: string;
  auto_qa_eligible_at: string;
  photo_count: number;
}

export interface AutoQaProcessResult {
  dropNumber: string;
  success: boolean;
  decision: QaDecision | null;
  skipped: boolean;
  skipReason?: string;
  photoCount: number;
  passed: number;
  failed: number;
  processingTimeMs: number;
  error?: string;
}

// ============================================================================
// FIND ELIGIBLE DRS
// ============================================================================

/**
 * Find DRs eligible for auto-QA processing.
 *
 * Criteria:
 * - auto_qa_eligible_at has passed (30 min since WA receipt)
 * - Not already auto-QA processed
 * - Has photos and VLM categorization is done
 * - Data extraction is complete
 * - Not already manually reviewed
 */
export async function findEligibleDRs(limit: number = 10): Promise<EligibleDR[]> {
  const result = await pool.query<EligibleDR>(
    `SELECT drop_number, auto_qa_eligible_at, photo_count
     FROM dr_photo_unified_reviews
     WHERE auto_qa_eligible_at <= NOW()
       AND auto_qa_processed = false
       AND photo_count > 0
       AND vlm_categorization_status IN ('categorized', 'approved')
       AND data_validation_completed = true
       AND (qa_decision IS NULL OR qa_decision_is_draft = true)
       AND (human_review_status IS NULL OR human_review_status != 'completed')
     ORDER BY auto_qa_eligible_at ASC
     LIMIT $1`,
    [limit]
  );

  return result.rows;
}

// ============================================================================
// PROCESS A SINGLE DR
// ============================================================================

/**
 * Run automated QA phases 1-4 for a single DR.
 * Returns the result without sending feedback (that's the human's job).
 */
export async function processOneDR(dropNumber: string): Promise<AutoQaProcessResult> {
  const startTime = Date.now();

  try {
    log.info('AutoQA', `Processing ${dropNumber}`);

    // Fetch all needed data in one query
    const drResult = await pool.query(
      `SELECT
         drop_number,
         photo_count,
         photos_metadata::text as photos_json,
         vlm_categorization_results::text as vlm_json,
         ont_serial_scanned,
         ups_serial_scanned,
         vlm_power_meter_dbm,
         vlm_ont_serial_step6,
         vlm_ont_serial_step9,
         vlm_dr_number_step9,
         project
       FROM dr_photo_unified_reviews
       WHERE drop_number = $1`,
      [dropNumber]
    );

    if (drResult.rows.length === 0) {
      return makeResult(dropNumber, startTime, { skipped: true, skipReason: 'DR not found' });
    }

    const dr = drResult.rows[0];
    const categorizations: VlmCategorizationResult[] = dr.vlm_json ? JSON.parse(dr.vlm_json) : [];

    if (categorizations.length === 0) {
      return makeResult(dropNumber, startTime, { skipped: true, skipReason: 'No VLM categorizations' });
    }

    // --- PHASE 1: Prerequisites ---
    const validationData: DrValidationData = {
      drNumber: dropNumber,
      photoCount: dr.photo_count,
      photos: categorizations.map((c) => ({
        filename: c.photo_filename,
        step: c.human_override_step ?? c.vlm_predicted_step ?? null,
      })),
      ontSerial: dr.ont_serial_scanned,
      upsSerial: dr.ups_serial_scanned,
      powerMeterDbm: dr.vlm_power_meter_dbm,
      vlmOntSerialStep6: dr.vlm_ont_serial_step6,
      vlmOntSerialStep9: dr.vlm_ont_serial_step9,
      vlmDrNumberStep9: dr.vlm_dr_number_step9,
    };

    const prereqs = checkPrerequisites(validationData);

    // --- PHASE 2: Photo Review (auto-approval tiers) ---
    const stepAccuracy = await getStepAccuracy();
    const tiers = assignTiers(categorizations, stepAccuracy);
    const tierSummary = buildSummary(tiers, stepAccuracy);

    // Skip if any photo requires human review
    if (tierSummary.humanRequired > 0) {
      return makeResult(dropNumber, startTime, {
        skipped: true,
        skipReason: `${tierSummary.humanRequired} photo(s) require human review`,
      });
    }

    // Build per-photo results
    const tierMap = new Map(tiers.map((t) => [t.photo_filename, t]));
    const photoResults: AutoQaPhotoResult[] = categorizations.map((cat) => {
      const tier = tierMap.get(cat.photo_filename);
      const step = cat.human_override_step ?? cat.vlm_predicted_step ?? 0;
      const tierValue = tier?.tier || 'review_recommended';
      const confidence = cat.vlm_confidence;

      // Auto-approved photos pass; review_recommended photos pass if confidence >= 0.70
      const decision: 'PASS' | 'FAIL' = step === 0 ? 'FAIL' : 'PASS';

      return {
        filename: cat.photo_filename,
        step,
        stepLabel: cat.vlm_predicted_category || `Step ${step}`,
        tier: tierValue,
        decision,
        comment: generatePhotoComment(step, tierValue, confidence, decision, cat.vlm_reasoning),
        confidence,
      };
    });

    // --- PHASE 3: Data Validation ---
    const stepCoverage = checkStepCoverage(validationData.photos);
    const powerMeter = validatePowerMeter(validationData.powerMeterDbm);
    const serialValidation = validateSerialCrossReference(validationData);

    // --- PHASE 4: Final Decision ---
    const autoFailResult = evaluateAutoFail(validationData);
    const decision = autoFailResult.recommendation;

    // Add missing step comments
    for (const missingStep of stepCoverage.missing) {
      photoResults.push({
        filename: `missing_step_${missingStep}`,
        step: missingStep,
        stepLabel: generateMissingStepComment(missingStep).split(':')[0] || `Step ${missingStep}`,
        tier: 'human_required',
        decision: 'FAIL',
        comment: generateMissingStepComment(missingStep),
        confidence: 0,
      });
    }

    const passed = photoResults.filter((p) => p.decision === 'PASS').length;
    const failed = photoResults.filter((p) => p.decision === 'FAIL').length;

    // Generate feedback message
    const validations = { prerequisites: prereqs, stepCoverage, powerMeter, serialValidation, autoFail: autoFailResult };
    const feedbackMessage = generateFeedbackMessage(dropNumber, decision, photoResults, validations);

    const autoQaResults: AutoQaResults = {
      summary: { total: photoResults.length, passed, failed, decision },
      photos: photoResults,
      validations,
      feedbackMessage,
    };

    // --- PERSIST RESULTS ---
    await persistAutoQaResults(dropNumber, decision, autoFailResult, autoQaResults, stepCoverage);

    // Log activity
    await logActivity(dropNumber, 'AUTO_QA_COMPLETED', {
      decision,
      reasons: autoFailResult.reasons,
      photosPassed: passed,
      photosFailed: failed,
      processingTimeMs: Date.now() - startTime,
      tierSummary: {
        autoApproved: tierSummary.autoApproved,
        reviewRecommended: tierSummary.reviewRecommended,
      },
    }, 'system:auto-qa');

    log.info('AutoQA', `Completed ${dropNumber}: ${decision}`, {
      passed, failed, reasons: autoFailResult.reasons,
    });

    return makeResult(dropNumber, startTime, {
      success: true, decision, photoCount: photoResults.length, passed, failed,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error('AutoQA', `Error processing ${dropNumber}: ${errMsg}`);
    return makeResult(dropNumber, startTime, { success: false, error: errMsg });
  }
}


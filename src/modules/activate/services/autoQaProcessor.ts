/**
 * Auto-QA Processor — runs QA wizard phases 1-4 for eligible DRs and parks
 * them at phase 5 (feedback) for human review. Helpers live in sibling
 * modules to keep this file under the 300-line CLAUDE.md limit.
 */

import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';
import {
  checkPrerequisites,
  checkStepCoverage,
  validatePowerMeter,
  validateSerialCrossReference,
  evaluateAutoFail,
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
import { persistAutoQaResults, makeResult, recordAutoQaAttempt, recordAutoQaError, buildValidationData, MAX_AUTO_QA_ATTEMPTS } from './autoQaHelpers';
import {
  flagWithinDrStepDuplicates,
  flagDateMismatchDuplicates,
  type DiscardedPhoto,
} from './autoQaDuplicateDetector';
import {
  applyOntBackCableCheck,
  applyStepQualityCheck,
} from './autoQaPhotoQualityChecks';
import { shouldHoldForIncompleteQualityCheck } from './autoQaHoldPolicy';
import type { VlmCategorizationResult, QaDecision } from '../types/unified.types';

// Re-export so existing imports (incl. tests) keep working after the split.
export {
  toSastYmd,
  parseStrictVlmDate,
  VLM_DATE_VALIDATION_ACTIVE_FROM,
} from './autoQaDateValidation';

const log = createLogger('AutoQA');

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

/**
 * Find DRs eligible for auto-QA processing.
 *
 * Criteria: auto_qa_eligible_at elapsed, not already processed, photos +
 * VLM categorization present, data extraction complete, not manually reviewed.
 */
export async function findEligibleDRs(limit: number = 10): Promise<EligibleDR[]> {
  const result = await pool.query<EligibleDR>(
    `SELECT drop_number, auto_qa_eligible_at, photo_count
     FROM dr_photo_unified_reviews
     WHERE auto_qa_eligible_at <= NOW()
       AND auto_qa_eligible_at >= NOW() - INTERVAL '2 days'  -- current DRs only, never the backlog
       AND auto_qa_processed = false
       AND COALESCE(auto_qa_attempts, 0) < $2                -- park poison pills after MAX attempts
       AND photo_count > 0
       AND vlm_categorization_status IN ('categorized', 'approved')
       AND data_validation_completed = true
       AND (qa_decision IS NULL OR qa_decision_is_draft = true)
       AND (human_review_status IS NULL OR human_review_status != 'completed')
     ORDER BY auto_qa_eligible_at ASC                        -- oldest-first: no starvation
     LIMIT $1`,
    [limit, MAX_AUTO_QA_ATTEMPTS],
  );

  return result.rows;
}

/**
 * Run automated QA phases 1-4 for a single DR. Returns the result without
 * sending feedback (that's the human's job).
 */
export async function processOneDR(dropNumber: string): Promise<AutoQaProcessResult> {
  const startTime = Date.now();

  try {
    log.info(`Processing ${dropNumber}`);

    await recordAutoQaAttempt(dropNumber); // poison-pill guard: count before processing

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
         project,
         submitted_date,
         vlm_categorized_at
       FROM dr_photo_unified_reviews
       WHERE drop_number = $1`,
      [dropNumber],
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
    const validationData = buildValidationData(dropNumber, dr, categorizations);
    const prereqs = checkPrerequisites(validationData);

    // --- PHASE 2: Photo Review (auto-approval tiers) ---
    const stepAccuracy = await getStepAccuracy();
    const tiers = assignTiers(categorizations, stepAccuracy);
    const tierSummary = buildSummary(tiers, stepAccuracy);

    const hasHumanRequired = tierSummary.humanRequired > 0;
    const tierMap = new Map(tiers.map((t) => [t.photo_filename, t]));
    const photoResults: AutoQaPhotoResult[] = categorizations.map((cat) => {
      const tier = tierMap.get(cat.photo_filename);
      const step = cat.human_override_step ?? cat.vlm_predicted_step ?? 0;
      const tierValue = tier?.tier || 'review_recommended';
      const confidence = cat.vlm_confidence;

      // human_required photos FAIL and get flagged for HITL step reassignment.
      // step=0 / Error always FAIL. Otherwise PASS.
      const decision: 'PASS' | 'FAIL' =
        step === 0 || tierValue === 'human_required' ? 'FAIL' : 'PASS';

      return {
        filename: cat.photo_filename,
        step,
        stepLabel: cat.vlm_predicted_category || `Step ${step}`,
        tier: tierValue,
        decision,
        comment: generatePhotoComment(step, tierValue, confidence, decision, cat.vlm_reasoning),
        confidence,
        identifiedAs: cat.vlm_identified_as,
        reasoning: cat.vlm_reasoning,
      };
    });

    // --- WITHIN-DR DEDUP (same-step) ---
    const discardedPhotos: DiscardedPhoto[] = [];
    const sameStepDups = flagWithinDrStepDuplicates(photoResults, discardedPhotos);
    if (sameStepDups > 0) {
      log.info(`Auto-discarded ${sameStepDups} within-DR duplicate(s) for ${dropNumber}`);
    }

    // --- DUPLICATE PHOTO CHECK (date mismatch) ---
    const submittedDate = dr.submitted_date ? new Date(dr.submitted_date) : null;
    if (submittedDate) {
      const photosMetadata: Array<{ filename: string; url: string }> = dr.photos_json
        ? JSON.parse(dr.photos_json)
        : [];
      const vlmCategorizedAt: Date | null = dr.vlm_categorized_at
        ? new Date(dr.vlm_categorized_at)
        : null;
      await flagDateMismatchDuplicates(
        dropNumber,
        photoResults,
        categorizations,
        submittedDate,
        vlmCategorizedAt,
        photosMetadata,
        discardedPhotos,
      );
    }

    // --- ONT BACK GREEN-CABLE CHECK + STEP QUALITY CHECK ---
    const photosMetadataForCable: Array<{ filename: string; url: string }> = dr.photos_json
      ? JSON.parse(dr.photos_json)
      : [];
    const urlByFilename = new Map(photosMetadataForCable.map((p) => [p.filename, p.url]));
    await applyOntBackCableCheck(dropNumber, photoResults, urlByFilename, discardedPhotos);
    const qualityCheck = await applyStepQualityCheck(dropNumber, photoResults, urlByFilename);

    // --- PHASE 3: Data Validation ---
    const stepCoverage = checkStepCoverage(validationData.photos);
    const powerMeter = validatePowerMeter(validationData.powerMeterDbm);
    const serialValidation = validateSerialCrossReference(validationData);

    // --- PHASE 4: Final Decision ---
    const autoFailResult = evaluateAutoFail(validationData);
    const decision = autoFailResult.recommendation;

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

    const validations = {
      prerequisites: prereqs,
      stepCoverage,
      powerMeter,
      serialValidation,
      autoFail: autoFailResult,
    };
    const feedbackMessage = generateFeedbackMessage(dropNumber, decision, photoResults, validations);

    const autoQaResults: AutoQaResults = {
      summary: { total: photoResults.length, passed, failed, decision },
      photos: photoResults,
      validations,
      feedbackMessage,
    };

    // Hold auto-feedback for human review only when the visual quality check was
    // inconclusive AND the verdict is PASS — a FAIL/REWORK verdict is provably
    // unaffected, so its feedback must still flow (see shouldHoldForIncompleteQualityCheck).
    const holdForHumanReason = shouldHoldForIncompleteQualityCheck(qualityCheck.checkIncomplete, decision) ? 'quality_check_incomplete' : null;
    if (qualityCheck.checkIncomplete) {
      log.warn(`${dropNumber}: visual quality check could not complete (VLM error after retries) — decision=${decision}, feedbackHeld=${!!holdForHumanReason}`);
    }

    await persistAutoQaResults(dropNumber, decision, autoFailResult, autoQaResults, stepCoverage, discardedPhotos, holdForHumanReason);

    await logActivity(
      dropNumber,
      'AUTO_QA_COMPLETED',
      {
        decision,
        reasons: autoFailResult.reasons,
        photosPassed: passed,
        photosFailed: failed,
        processingTimeMs: Date.now() - startTime,
        tierSummary: {
          autoApproved: tierSummary.autoApproved,
          reviewRecommended: tierSummary.reviewRecommended,
          humanRequired: tierSummary.humanRequired,
        },
        hasHumanRequired,
      },
      'system:auto-qa',
    );

    log.info(`Completed ${dropNumber}: ${decision}`, {
      passed,
      failed,
      reasons: autoFailResult.reasons,
    });

    return makeResult(dropNumber, startTime, {
      success: true,
      decision,
      photoCount: photoResults.length,
      passed,
      failed,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error(`Error processing ${dropNumber}: ${errMsg}`);
    // Surface WHY this DR failed (it shows up parked once it hits the cap).
    await recordAutoQaError(dropNumber, errMsg);
    return makeResult(dropNumber, startTime, { success: false, error: errMsg });
  }
}

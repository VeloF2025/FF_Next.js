/**
 * Auto-QA Processor
 *
 * Programmatically runs QA wizard phases 1-4 for eligible DRs,
 * then parks them at phase 5 (feedback) for human review.
 *
 * Eligible DRs: received 30+ min ago, photos categorized, data extracted,
 * not yet QA'd. DRs with low-confidence photos are still processed —
 * uncertain photos are flagged for HITL review in phase 5.
 */

import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';

const log = createLogger('AutoQA');

// ============================================================================
// DATE VALIDATION HELPERS
// ============================================================================

/**
 * Minimum VLM categorization run date for which date-stamp validation is active.
 *
 * Choice: Option B — we skip the duplicate-photo date-mismatch rule for DRs
 * whose VLM categorization ran before this cutoff, because those older runs
 * pre-date the `vlm_date_stamps` extraction feature and will always produce
 * empty arrays, leading to false negatives rather than false positives.
 * Any DR categorized on or after this date is guaranteed to have the new
 * date-stamp extraction prompt active.
 */
export const VLM_DATE_VALIDATION_ACTIVE_FROM = '2026-04-21';

/**
 * Regex for the strict ISO-8601-ish formats the VLM is instructed to emit.
 * Accepts:
 *   YYYY-MM-DD
 *   YYYY-MM-DDTHH:MM
 *   YYYY-MM-DDTHH:MM:SS
 *   YYYY-MM-DD HH:MM
 *   YYYY-MM-DD HH:MM:SS
 */
const STRICT_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/;

/**
 * Format a Date object as a YYYY-MM-DD string using the SAST timezone
 * (Africa/Johannesburg, UTC+2).  Using `en-CA` locale because it produces
 * the canonical YYYY-MM-DD format without any locale-specific separators.
 *
 * This avoids the UTC-drift bug where `toISOString().split('T')[0]` can
 * return the previous calendar day for a SAST date at or near midnight.
 */
export function toSastYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Validate a raw VLM date string and return a Date if it passes strict
 * format checks, or null if it should be rejected.
 *
 * Only strings matching `YYYY-MM-DD[...optional time...]` are accepted.
 * Ambiguous formats like `10/3/2026` or `03/10/2026` are always rejected
 * to prevent silent MM/DD vs DD/MM misinterpretation.
 *
 * @param raw - The raw string from VLM output
 * @param dropNumber - DR number for log context
 * @returns Parsed Date in SAST context, or null if rejected
 */
export function parseStrictVlmDate(raw: string, dropNumber: string): Date | null {
  if (!STRICT_DATE_RE.test(raw)) {
    log.warn(`VLM_DATE_EXTRACTION_REJECTED: ambiguous/non-ISO format "${raw}" for DR ${dropNumber} — skipped`);
    return null;
  }
  // Parse as a UTC-anchored date (YYYY-MM-DD is unambiguous once we have validated format)
  const d = new Date(raw.includes('T') || raw.includes(' ') ? raw.replace(' ', 'T') : `${raw}T00:00:00Z`);
  if (isNaN(d.getTime())) {
    log.warn(`VLM_DATE_EXTRACTION_REJECTED: valid format but unparseable "${raw}" for DR ${dropNumber} — skipped`);
    return null;
  }
  // Reject invalid calendar days (e.g. 2026-02-30 rolls over to 2026-03-02 silently).
  const [yyyy, mm, dd] = raw.slice(0, 10).split('-').map(Number);
  if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() + 1 !== mm || d.getUTCDate() !== dd) {
    log.warn(`VLM_DATE_EXTRACTION_REJECTED: invalid calendar date "${raw}" for DR ${dropNumber} — skipped`);
    return null;
  }
  return d;
}
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
import { STEP_LABELS } from '../utils/stepMapper';
import { extractExifDatesForPhotos } from './photoDateValidator';
import { validateOntBackCables } from './ontBackCableValidator';
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
     ORDER BY auto_qa_eligible_at DESC
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
    log.info(`Processing ${dropNumber}`);

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
         project,
         submitted_date,
         vlm_categorized_at
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

    // Build per-photo results — process ALL photos including human_required
    // Low-confidence photos are flagged as FAIL for HITL review in phase 5
    const hasHumanRequired = tierSummary.humanRequired > 0;
    const tierMap = new Map(tiers.map((t) => [t.photo_filename, t]));
    const photoResults: AutoQaPhotoResult[] = categorizations.map((cat) => {
      const tier = tierMap.get(cat.photo_filename);
      const step = cat.human_override_step ?? cat.vlm_predicted_step ?? 0;
      const tierValue = tier?.tier || 'review_recommended';
      const confidence = cat.vlm_confidence;

      // human_required photos FAIL and get flagged for HITL step reassignment
      // step=0 or Error always FAIL
      // Otherwise PASS
      let decision: 'PASS' | 'FAIL';
      if (step === 0 || tierValue === 'human_required') {
        decision = 'FAIL';
      } else {
        decision = 'PASS';
      }

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

    // --- WITHIN-DR DEDUP: for steps 1-10, keep first photo, mark extras as duplicates (step -1) ---
    const seenSteps = new Set<number>();
    let autoDiscardedCount = 0;
    const discardedPhotos: Array<{ filename: string; originalStep: number; reason: string }> = [];

    for (const photo of photoResults) {
      const step = photo.step;
      if (step >= 1 && step <= 10) {
        if (seenSteps.has(step)) {
          const originalLabel = STEP_LABELS[step] || `Step ${step}`;
          const reason = `Duplicate of ${originalLabel} — only one photo per step is kept`;
          discardedPhotos.push({ filename: photo.filename, originalStep: step, reason });
          photo.step = -1;
          photo.stepLabel = 'Duplicate Photo';
          photo.decision = 'FAIL';
          photo.comment = reason;
          autoDiscardedCount++;
        } else {
          seenSteps.add(step);
        }
      }
    }

    if (autoDiscardedCount > 0) {
      log.info(`Auto-discarded ${autoDiscardedCount} within-DR duplicate(s) for ${dropNumber}`);
    }

    // --- DUPLICATE PHOTO CHECK (date mismatch on any available source) ---
    // Any photo with a detectable date (EXIF metadata OR VLM-extracted visible
    // date stamp(s)) that doesn't match the DR submission day within a 2-day
    // tolerance is marked as Duplicate Photo. Applies to both:
    //  • Single-date mismatch (e.g. one burned-in 10-month-old stamp)
    //  • Multi-date mismatch (re-photographed content with 2+ visible stamps)
    // Rationale: any date discrepancy is a strong signal of recycled content.
    const submittedDate = dr.submitted_date ? new Date(dr.submitted_date) : null;
    if (submittedDate) {
      const photosMetadata: Array<{ filename: string; url: string }> = dr.photos_json ? JSON.parse(dr.photos_json) : [];
      const exifDates = await extractExifDatesForPhotos(dropNumber, photosMetadata);

      // --- HISTORIC-DATA SCOPE GUARD (Blocker 4 — Option B) ---
      // Only apply VLM date-stamp validation when the DR's VLM categorization
      // run occurred on or after VLM_DATE_VALIDATION_ACTIVE_FROM (2026-04-21).
      // Older runs pre-date the date_stamps extraction prompt and will always
      // produce empty arrays, so applying the rule would be a no-op — but
      // being explicit here makes the intent clear and guards against future
      // backfill attempts reprocessing historic data with incorrect verdicts.
      const vlmCategorizedAt: Date | null = dr.vlm_categorized_at ? new Date(dr.vlm_categorized_at) : null;
      const vlmDateValidationCutoff = new Date(`${VLM_DATE_VALIDATION_ACTIVE_FROM}T00:00:00+02:00`);
      const vlmDateValidationActive = vlmCategorizedAt !== null && vlmCategorizedAt >= vlmDateValidationCutoff;

      if (!vlmDateValidationActive) {
        log.debug(`Skipping VLM date-stamp validation for ${dropNumber} — vlm_categorized_at (${vlmCategorizedAt?.toISOString() ?? 'null'}) is before cutoff ${VLM_DATE_VALIDATION_ACTIVE_FROM}`);
      }

      // Build VLM date stamp map from categorizations (all visible dates per photo).
      // Only populated when validation is active to avoid wasted work on historic DRs.
      const vlmAllDatesMap = new Map<string, Date[]>();
      if (vlmDateValidationActive) {
        for (const cat of categorizations) {
          const rawDates: string[] = Array.isArray(cat.vlm_date_stamps) && cat.vlm_date_stamps.length > 0
            ? cat.vlm_date_stamps
            : cat.vlm_date_stamp
              ? [cat.vlm_date_stamp]
              : [];

          // Blocker 1: Strict regex validation — reject ambiguous formats (MM/DD/YYYY, etc.)
          const parsedDates: Date[] = [];
          for (const raw of rawDates) {
            const parsed = parseStrictVlmDate(raw, dropNumber);
            if (parsed !== null) {
              parsedDates.push(parsed);
            }
            // rejected strings are logged inside parseStrictVlmDate with VLM_DATE_EXTRACTION_REJECTED
          }

          if (parsedDates.length > 0) {
            vlmAllDatesMap.set(cat.photo_filename, parsedDates);
          } else if (rawDates.length > 0) {
            // All entries were rejected — telemetry (per blocker 1)
            log.info(`VLM_DATE_EXTRACTION_REJECTED: all ${rawDates.length} raw date(s) for photo ${cat.photo_filename} on DR ${dropNumber} failed strict validation — treated as no date`);
          }
        }

        if (vlmAllDatesMap.size > 0) {
          log.info(`VLM extracted visible date stamps for ${vlmAllDatesMap.size}/${categorizations.length} photos on ${dropNumber}`);
        }
      }

      // Blocker 2: SAST-aware YMD comparison instead of toISOString().split('T')[0]
      const submittedYmd = toSastYmd(submittedDate);
      const MAX_DIFF_DAYS = 2;

      for (const photo of photoResults) {
        if (photo.step === -1) continue; // already discarded

        // Collect all candidate dates for this photo from every available source
        const candidateDates: Array<{ date: Date; source: string }> = [];
        const exifDate = exifDates.get(photo.filename);
        if (exifDate) candidateDates.push({ date: exifDate, source: 'EXIF' });

        // Only include VLM dates when validation is active (scope guard)
        if (vlmDateValidationActive) {
          const vlmDates = vlmAllDatesMap.get(photo.filename) ?? [];
          for (const d of vlmDates) candidateDates.push({ date: d, source: 'visible date stamp' });
        }

        if (candidateDates.length === 0) continue; // nothing to compare against

        // Flag if ANY candidate date is >2 days from DR submission.
        // Blocker 2: compare using SAST-aware YMD strings via toSastYmd()
        const mismatched = candidateDates.filter(({ date }) => {
          const diffDays = Math.abs(date.getTime() - submittedDate.getTime()) / (1000 * 60 * 60 * 24);
          return diffDays > MAX_DIFF_DAYS;
        });

        if (mismatched.length === 0) continue;

        // Build a reason message that reflects the number and source of dates found
        // Blocker 2: use toSastYmd() instead of toISOString().split('T')[0] for display
        const datesList = candidateDates
          .map((c) => `${toSastYmd(c.date)} (${c.source})`)
          .join(', ');
        const reason = candidateDates.length >= 2
          ? `Duplicate photo — ${candidateDates.length} date stamps found (${datesList}) but DR submitted on ${submittedYmd}. Photo appears to be a re-photograph of older content.`
          : `Duplicate photo — ${candidateDates[0]!.source} shows ${toSastYmd(candidateDates[0]!.date)} but DR submitted on ${submittedYmd}. Photo date does not match DR submission day.`;

        discardedPhotos.push({ filename: photo.filename, originalStep: photo.step, reason });
        photo.step = -1;
        photo.stepLabel = 'Duplicate Photo';
        photo.decision = 'FAIL';
        photo.comment = reason;
        autoDiscardedCount++;
      }

      const dateDupCount = discardedPhotos.filter((d) => d.reason.startsWith('Duplicate photo — ')).length;
      if (dateDupCount > 0) {
        log.info(`Auto-discarded ${dateDupCount} photo(s) as Duplicate Photo (date mismatch) on ${dropNumber}`);
      }
    }

    // --- ONT BACK GREEN-CABLE CHECK ---
    // A true "ONT Back After Install" photo must show a green fiber cable
    // plugged into the fiber port. Without that cable the ONT is not actually
    // installed, so reclassify to Step 0 (Discard) with a specific comment.
    const photosMetadataForCable: Array<{ filename: string; url: string }> = dr.photos_json ? JSON.parse(dr.photos_json) : [];
    const urlByFilename = new Map(photosMetadataForCable.map((p) => [p.filename, p.url]));
    const step6PhotosForCheck = photoResults
      .filter((p) => p.step === 6 && urlByFilename.has(p.filename))
      .map((p) => ({ filename: p.filename, url: urlByFilename.get(p.filename)! }));

    if (step6PhotosForCheck.length > 0) {
      const cableResults = await validateOntBackCables(dropNumber, step6PhotosForCheck);
      let noCableCount = 0;
      for (const photo of photoResults) {
        if (photo.step !== 6) continue;
        const result = cableResults.get(photo.filename);
        if (!result || result.checkFailed) continue; // leave classification alone on check failure
        if (!result.hasGreenCable) {
          const reason = 'No green cable in the back';
          discardedPhotos.push({ filename: photo.filename, originalStep: photo.step, reason });
          photo.step = 0;
          photo.stepLabel = 'Discard - Rubbish';
          photo.decision = 'FAIL';
          photo.comment = reason;
          autoDiscardedCount++;
          noCableCount++;
        }
      }
      if (noCableCount > 0) {
        log.info(`Reclassified ${noCableCount} Step 6 photo(s) to Step 0 for missing green fiber cable on ${dropNumber}`);
      }
    }

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
    await persistAutoQaResults(dropNumber, decision, autoFailResult, autoQaResults, stepCoverage, discardedPhotos);

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
        humanRequired: tierSummary.humanRequired,
      },
      hasHumanRequired,
    }, 'system:auto-qa');

    log.info(`Completed ${dropNumber}: ${decision}`, {
      passed, failed, reasons: autoFailResult.reasons,
    });

    return makeResult(dropNumber, startTime, {
      success: true, decision, photoCount: photoResults.length, passed, failed,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error(`Error processing ${dropNumber}: ${errMsg}`);
    return makeResult(dropNumber, startTime, { success: false, error: errMsg });
  }
}


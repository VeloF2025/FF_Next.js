/**
 * Shared per-appeal scoring logic for the appeals-VLM pipeline, used by BOTH the
 * batch cron (pages/api/cron/appeals-vlm) and the on-submit fast path
 * (pages/api/my/sitecam/appeal). Keeping it in one place means the cron and the
 * instant path make identical decisions.
 *
 * Decision policy (go-live, when the flag is on):
 *   - Only a clear `approve`/`deny` at confidence >= AUTO_DECIDE_MIN_CONFIDENCE
 *     is auto-applied. `uncertain` / low confidence stay pending for a human.
 *   - A PHOTO appeal is auto-decided ONLY if it was cross-referenced against the
 *     step's gallery (galleryExamplesUsed > 0). No gallery reference → no auto
 *     decision, it falls back to the human queue. Serial appeals (barcode/OCR,
 *     no gallery) are gated on confidence alone.
 *   - A transient VLM outage is retried; every other outcome is written once.
 */
import { log } from '@/lib/logger';
import type { SiteCamJobType } from '@/modules/sitecam/lib/sitecamSteps';
import { evaluateAppeal, type AppealInput, type AppealEvaluation } from './appealsVlmService';
import {
  findEligibleAppealById,
  isAutoDecideEnabled,
  recordAutoDecision,
  recordEvaluation,
  recordTransientFailure,
  type PendingAppeal,
} from './appealsVlmStore';

const MODULE = 'AppealsVlmRunner';

/** Minimum VLM confidence for the cron/fast-path to auto-apply an approve/deny. */
export const AUTO_DECIDE_MIN_CONFIDENCE = 0.8;

export type ProcessOutcome = 'auto_decided' | 'scored' | 'retried' | 'noop';

/** Strip the `data:image/…;base64,` prefix — the evaluator expects raw base64. */
export function toRawBase64(dataUri: string | null): string {
  return (dataUri ?? '').replace(/^data:image\/[^;]+;base64,/, '');
}

export function toAppealInput(a: PendingAppeal): AppealInput {
  return {
    jobType: (a.job_type ?? 'activations') as SiteCamJobType,
    stepNumber: a.step_number,
    photoBase64: toRawBase64(a.photo_url),
    appealText: a.appeal_text,
    serialScanned: a.serial_scanned,
    serialExpected: a.serial_expected,
  };
}

/**
 * True when this evaluation qualifies for an automatic decision. Kept pure so the
 * threshold + gallery-cross-reference rules are unit-testable without a DB.
 */
export function qualifiesForAutoDecision(evaluation: AppealEvaluation): boolean {
  const rec = evaluation.recommendation;
  if (rec !== 'approve' && rec !== 'deny') return false;
  if (evaluation.confidence < AUTO_DECIDE_MIN_CONFIDENCE) return false;
  // Photo mode carries a gallery count; serial mode leaves it undefined. Require a
  // photo to have actually been cross-referenced against the gallery before deciding.
  const isPhotoMode = evaluation.galleryExamplesUsed !== undefined;
  if (isPhotoMode && (evaluation.galleryExamplesUsed ?? 0) <= 0) return false;
  return true;
}

/**
 * Evaluate one appeal and persist the result. `autoDecide` is the resolved flag
 * value (read once by the caller). Never throws for an expected VLM outcome —
 * callers still wrap in try/catch for unexpected errors.
 */
export async function processAppeal(appeal: PendingAppeal, autoDecide: boolean): Promise<ProcessOutcome> {
  const evaluation = await evaluateAppeal(toAppealInput(appeal));

  // Only a transient VLM outage is retryable; everything else is terminal.
  if (evaluation.skipReason === 'vlm_unavailable') {
    const { attempts, parked } = await recordTransientFailure(appeal.id, evaluation, 3);
    if (parked) {
      log.error(`Appeal ${appeal.id} parked after ${attempts} VLM outages`, undefined, MODULE);
    } else {
      log.warn(`Appeal ${appeal.id} VLM unavailable — attempt ${attempts}/3, will retry`, undefined, MODULE);
    }
    return 'retried';
  }

  if (autoDecide && qualifiesForAutoDecision(evaluation)) {
    const decision = evaluation.recommendation === 'approve' ? 'approved' : 'denied';
    const applied = await recordAutoDecision(appeal.id, evaluation, decision);
    if (applied) {
      log.info(
        `Appeal ${appeal.id} AUTO-${decision.toUpperCase()} (${evaluation.confidence}) — sent to technician`,
        undefined,
        MODULE,
      );
      return 'auto_decided';
    }
    // Lost the race (already scored/decided) — nothing to record.
    return 'noop';
  }

  const applied = await recordEvaluation(appeal.id, evaluation);
  if (applied) {
    log.info(`Appeal ${appeal.id} scored (advisory): ${evaluation.recommendation} (${evaluation.confidence})`, undefined, MODULE);
    return 'scored';
  }
  return 'noop';
}

/**
 * Fast path: score a single freshly-submitted appeal immediately. Best-effort —
 * the batch cron is the safety net, so a failure here is logged and swallowed and
 * must NEVER surface to the technician's submit request. No-ops if the appeal was
 * already scored/decided (e.g. a cron tick beat us to it).
 */
export async function scoreAppealNow(appealId: string): Promise<void> {
  try {
    const appeal = await findEligibleAppealById(appealId);
    if (!appeal) return;
    const autoDecide = await isAutoDecideEnabled();
    await processAppeal(appeal, autoDecide);
  } catch (err) {
    log.warn('On-submit appeal scoring failed (cron will retry)', { appealId, err: String(err) }, MODULE);
  }
}

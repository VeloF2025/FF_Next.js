/**
 * Policy for holding a DR's auto-feedback pending human review.
 *
 * Kept as a tiny, dependency-free module so the safety invariant is unit-testable
 * without importing the full auto-QA processor.
 */
import type { QaDecision } from '../types/unified.types';

/**
 * Whether a DR must be held for human review because the visual quality check
 * could not complete (VLM error after retries).
 *
 * The visual check can only ever demote a photo PASS->FAIL, never promote
 * (see autoQaPhotoQualityChecks.ts). So an inconclusive check can only have left
 * a PASS verdict too lenient — the "approved" case the hold exists to protect.
 * A FAIL / REWORK_NEEDED decision is provably unaffected, so its corrective
 * feedback is accurate and must NOT be held: otherwise a VLM quality-check outage
 * silently strands ALL auto-feedback (as it did 2026-07-10, when a model change
 * broke the check and ~200 FAIL DRs went days with no acknowledgement to techs).
 */
export function shouldHoldForIncompleteQualityCheck(
  checkIncomplete: boolean,
  decision: QaDecision,
): boolean {
  return checkIncomplete && decision === 'PASS';
}

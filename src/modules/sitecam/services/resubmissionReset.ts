/**
 * Reset the prior QA cycle when a DR is (re)submitted through SiteCam.
 *
 * Background (2026-06-15): SiteCam re-photographs of already-activated DRs were
 * showing a green "Human ✓" badge in the QA Centre even though no human had
 * reviewed the new submission. The badge derives "Human ✓" from
 * `feedback_sent = true AND qa_decision_by NOT LIKE 'system:%'`
 * (see QaCentrePage.getQaReviewStatus). Old activations re-shot in SiteCam still
 * carried `feedback_sent = true` / a human `qa_decision_by` from their original
 * (e.g. January) review, so the stale flag rendered as a fresh human review.
 *
 * The auto-QA path (`autoQaHelpers.persistAutoQaResults`) and the WA/1Map
 * resubmission path (`ack/drStatusService.markForRework`) already reset this
 * state when a new cycle starts. The SiteCam upload endpoint did not — it only
 * wrote the `pwa_*` columns. This helper closes that gap with the same
 * "new submission ⇒ new QA cycle" semantics.
 *
 * Guarded so it only fires for rows that actually had a prior QA cycle: brand
 * new drops keep `submission_count = 1` and are left untouched.
 */

import pool from '@/lib/db';
import { log } from '@/lib/logger';

const MODULE = 'SiteCamResubmissionReset';

/**
 * Archive the current QA cycle into `submission_history`, bump
 * `submission_count`, and clear the stale QA-decision / feedback markers so a
 * SiteCam (re)submission starts a clean cycle.
 *
 * Only affects rows that already carry a prior cycle
 * (`feedback_sent = true` OR `qa_decision IS NOT NULL` OR
 * `auto_qa_processed = true`). Non-fatal: a failure here must not lose the
 * technician's photo submission, so errors are logged and swallowed.
 *
 * Idempotency (PWA Phase 2 PR-2): `clientSubmissionId`, when supplied, is
 * tagged onto the archived snapshot as `client_submission_id`. A lost-ack
 * retry from the offline queue (PR-3) replays the same id, so the WHERE
 * clause's replay guard compares it against the most recent snapshot
 * (`submission_history -> -1`) and no-ops on a match — the reset fires at
 * most once per submission. Legacy/online callers that omit the id keep
 * today's unguarded behaviour.
 */
export async function resetPriorQaCycleForResubmission(
  dropNumber: string,
  clientSubmissionId?: string,
): Promise<void> {
  const cid = clientSubmissionId ?? null;
  try {
    const { rowCount } = await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET
         -- Snapshot the cycle we are about to clear, for audit/history
         submission_history = COALESCE(submission_history, '[]'::jsonb) || jsonb_build_object(
           'submission_number', COALESCE(submission_count, 1),
           'snapshot_at', NOW(),
           'source', 'sitecam',
           'qa_decision', qa_decision,
           'qa_decision_at', qa_decision_at,
           'qa_decision_by', qa_decision_by,
           'feedback_sent', feedback_sent,
           'feedback_sent_at', feedback_sent_at,
           'feedback_message', feedback_message,
           'qa_phase', qa_phase,
           'client_submission_id', $2
         ),
         submission_count = COALESCE(submission_count, 1) + 1,
         -- Clear the QA decision so the badge no longer reads a stale human/auto review
         qa_phase = NULL,
         qa_decision = NULL,
         qa_decision_at = NULL,
         qa_decision_by = NULL,
         -- Clear feedback markers (drives the false "Human ✓" + blocks auto-feedback cron)
         feedback_sent = false,
         feedback_sent_at = NULL,
         feedback_message = NULL,
         -- Clear auto-QA markers so the new submission is re-evaluated
         auto_qa_processed = false,
         auto_qa_processed_at = NULL,
         auto_feedback_sent_at = NULL,
         auto_feedback_attempts = 0,
         auto_feedback_skip_reason = NULL,
         updated_at = NOW()
       WHERE drop_number = $1
         AND (feedback_sent = true OR qa_decision IS NOT NULL OR auto_qa_processed = true)
         AND ($2 IS NULL OR COALESCE(submission_history -> -1 ->> 'client_submission_id', '') <> $2)`,
      [dropNumber, cid],
    );

    if (rowCount && rowCount > 0) {
      log.info('Reset prior QA cycle for SiteCam resubmission', { dropNumber }, MODULE);
    }
  } catch (error) {
    // Must not block the photo submission — log and continue.
    log.warn('Failed to reset prior QA cycle for SiteCam resubmission', {
      dropNumber,
      error: String(error),
    }, MODULE);
  }
}

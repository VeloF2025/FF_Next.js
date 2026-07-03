/**
 * Reset the prior QA/review cycle when a NEW WhatsApp submission supersedes an
 * earlier one for the same DR.
 *
 * Background (2026-07-03): resubmitted DRs were showing a stale green "Human ✓"
 * badge in the QA Centre even though nobody had reviewed the new photos. The
 * badge derives "Human ✓" from `feedback_sent = true AND qa_decision_by NOT
 * LIKE 'system:%'` (see QaCentrePage.getQaReviewStatus). A DR reviewed in a
 * previous cycle still carried `feedback_sent = true` from that cycle, so the
 * stale flag rendered as a fresh human review — most visibly on DRs that can
 * never self-heal (e.g. a 0-photo resubmission is not auto-QA-eligible, so the
 * auto-QA path never runs to clear it).
 *
 * The auto-QA path (`autoQaHelpers.persistAutoQaResults`) and the SiteCam upload
 * path (`sitecam/services/resubmissionReset`) already reset this state on a new
 * cycle. The WhatsApp/1Map photo re-ingest path (`drRecordService`) did not —
 * it refreshed `wa_received_at` / re-armed `auto_qa_eligible_at` but left the
 * prior decision + feedback markers intact. This closes that gap.
 *
 * Count-bump + submission_history archival are owned by the caller
 * (`drRecordService`), so this clears only the live cycle fields. Guarded so it
 * only fires for rows that carry a prior cycle — a no-op for fresh drops.
 * Non-fatal: a failure must never drop the technician's submission.
 */
import pool from '@/lib/db';
import { log } from '@/lib/logger';

const MODULE = 'ReviewCycleReset';

export async function resetReviewCycleForResubmission(dropNumber: string): Promise<void> {
  try {
    const { rowCount } = await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET
         -- Clear the QA decision so the badge no longer reads a stale review
         qa_phase = NULL,
         qa_decision = NULL,
         qa_decision_at = NULL,
         qa_decision_by = NULL,
         -- Clear feedback markers (drive the false "Human ✓" + block the cron)
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
         AND (feedback_sent = true OR qa_decision IS NOT NULL OR auto_qa_processed = true)`,
      [dropNumber],
    );

    if (rowCount && rowCount > 0) {
      log.info('Reset prior review cycle for resubmission', { dropNumber }, MODULE);
    }
  } catch (error) {
    // Must not block the photo submission — log and continue.
    log.warn('Failed to reset prior review cycle for resubmission', {
      dropNumber,
      error: String(error),
    }, MODULE);
  }
}

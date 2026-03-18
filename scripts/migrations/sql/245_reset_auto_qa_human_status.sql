-- Migration 245: Reset DRs incorrectly marked as human-reviewed
--
-- The auto-QA system was setting qa_decision and qa_phase='feedback' on DRs,
-- and the UI was displaying these as "Human ✓" (checked by human editors)
-- even though no human actually reviewed them.
--
-- This migration resets all auto-QA processed DRs where NO human has reviewed
-- them back to a state where the auto-QA pipeline can re-process them and
-- a human can approve before feedback is sent.

BEGIN;

-- Step 1: Log the DRs that will be reset (for audit trail)
-- Count DRs that were auto-QA'd but have no human reviewer
DO $$
DECLARE
  reset_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO reset_count
  FROM dr_photo_unified_reviews
  WHERE qa_decision_by = 'system:auto-qa'
    AND (human_reviewer_id IS NULL)
    AND (feedback_sent IS NULL OR feedback_sent = false);

  RAISE NOTICE 'Resetting % DRs with auto-QA decisions and no human review (feedback not yet sent)', reset_count;
END $$;

-- Step 2: Reset auto-QA processed DRs where:
--   - Decision was made by system:auto-qa
--   - No human has reviewed (human_reviewer_id IS NULL)
--   - Feedback has NOT been sent yet (can't unsend WhatsApp messages)
--
-- This preserves: VLM categorization, data validation, photos, step booleans
-- The auto-QA cron will re-process these within 5 minutes
UPDATE dr_photo_unified_reviews
SET
  auto_qa_processed = false,
  auto_qa_processed_at = NULL,
  auto_qa_results = NULL,
  qa_decision = NULL,
  qa_decision_at = NULL,
  qa_decision_by = NULL,
  qa_decision_reasons = NULL,
  qa_decision_is_draft = NULL,
  qa_decision_notes = NULL,
  qa_internal_notes = NULL,
  qa_technician_feedback = NULL,
  qa_issue_classification = NULL,
  qa_phase = NULL,
  human_review_status = NULL,
  human_review_completed_at = NULL,
  human_reviewer_id = NULL,
  human_qa_overrides = NULL,
  vlm_qa_status = NULL,
  updated_at = NOW()
WHERE qa_decision_by = 'system:auto-qa'
  AND (human_reviewer_id IS NULL)
  AND (feedback_sent IS NULL OR feedback_sent = false);

-- Step 3: Also handle DRs where feedback WAS sent by auto-QA without human review
-- These can't be unsent, but mark them clearly so humans know to re-review
DO $$
DECLARE
  sent_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO sent_count
  FROM dr_photo_unified_reviews
  WHERE qa_decision_by = 'system:auto-qa'
    AND (human_reviewer_id IS NULL)
    AND feedback_sent = true;

  RAISE NOTICE '% DRs have auto-QA feedback already sent without human review (these need manual attention)', sent_count;
END $$;

-- For DRs where feedback was already sent without human review,
-- reset the human_review_status so they show correctly in the UI
-- but keep feedback_sent=true since the message was already delivered
UPDATE dr_photo_unified_reviews
SET
  human_review_status = 'pending_hitl',
  human_review_completed_at = NULL,
  human_reviewer_id = NULL,
  updated_at = NOW()
WHERE qa_decision_by = 'system:auto-qa'
  AND (human_reviewer_id IS NULL)
  AND feedback_sent = true
  AND (human_review_status IS NOT NULL AND human_review_status != 'pending_hitl');

COMMIT;

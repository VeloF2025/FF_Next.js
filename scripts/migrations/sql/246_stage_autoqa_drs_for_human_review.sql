-- Migration 246: Stage auto-QA'd DRs for human review
--
-- After migration 245 reset DRs, the auto-QA cron re-processed them within
-- 5 minutes. DRs that previously had feedback_sent=true are now blocked from
-- re-sending feedback by the send-feedback endpoint.
--
-- This migration:
-- 1. Resets feedback_sent so human operators can send feedback via QA Centre
-- 2. Keeps auto_qa_processed=true so the cron does NOT re-grab them
-- 3. Sets human_review_status='pending_hitl' so they appear in human queue
-- 4. Preserves all auto-QA analysis results for human review

BEGIN;

-- Step 1: Count affected DRs (audit trail)
DO $$
DECLARE
  total_count INTEGER;
  feedback_sent_count INTEGER;
  feedback_not_sent_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_count
  FROM dr_photo_unified_reviews
  WHERE qa_decision_by = 'system:auto-qa'
    AND (human_reviewer_id IS NULL);

  SELECT COUNT(*) INTO feedback_sent_count
  FROM dr_photo_unified_reviews
  WHERE qa_decision_by = 'system:auto-qa'
    AND (human_reviewer_id IS NULL)
    AND feedback_sent = true;

  SELECT COUNT(*) INTO feedback_not_sent_count
  FROM dr_photo_unified_reviews
  WHERE qa_decision_by = 'system:auto-qa'
    AND (human_reviewer_id IS NULL)
    AND (feedback_sent IS NULL OR feedback_sent = false);

  RAISE NOTICE 'Total auto-QA DRs without human review: %', total_count;
  RAISE NOTICE '  - feedback_sent=true (blocked): %', feedback_sent_count;
  RAISE NOTICE '  - feedback not yet sent: %', feedback_not_sent_count;
END $$;

-- Step 2: Reset ALL auto-QA'd DRs (no human reviewer) to pending_hitl
-- Reset feedback_sent so humans can send feedback from QA Centre
-- Keep auto_qa_processed=true so the cron skips them
-- Keep auto_qa_results so humans can see the AI analysis
UPDATE dr_photo_unified_reviews
SET
  feedback_sent = false,
  feedback_message = NULL,
  feedback_sent_at = NULL,
  human_review_status = 'pending_hitl',
  human_review_completed_at = NULL,
  human_reviewer_id = NULL,
  human_qa_overrides = NULL,
  updated_at = NOW()
WHERE qa_decision_by = 'system:auto-qa'
  AND (human_reviewer_id IS NULL);

-- Step 3: Verify
DO $$
DECLARE
  remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining
  FROM dr_photo_unified_reviews
  WHERE qa_decision_by = 'system:auto-qa'
    AND (human_reviewer_id IS NULL)
    AND feedback_sent = true;

  RAISE NOTICE 'After migration: % DRs still have feedback_sent=true (should be 0)', remaining;
END $$;

COMMIT;

-- Migration 432: Auto-QA attempt tracking (poison-pill guard)
-- Purpose: let the auto-QA cron count processing attempts per DR so a DR that
-- repeatedly errors is parked after N tries instead of being retried forever
-- and silently never sent. last_error surfaces WHY; last_attempt_at shows when.
-- Additive and backward-compatible: existing rows default to 0 / NULL and are
-- untouched until the hardened processOneDR runs.

ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN IF NOT EXISTS auto_qa_attempts        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_qa_last_error      TEXT,
  ADD COLUMN IF NOT EXISTS auto_qa_last_attempt_at TIMESTAMPTZ;

COMMENT ON COLUMN dr_photo_unified_reviews.auto_qa_attempts IS
  'Number of times the auto-QA processor has attempted this DR. findEligibleDRs skips rows at/above the cap (MAX_AUTO_QA_ATTEMPTS) so a poison-pill stops being retried and surfaces for review.';

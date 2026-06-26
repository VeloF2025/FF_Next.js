-- Migration 425: photo re-fetch resilience columns
--
-- Problem: when process-new-dr fetches a DR but OneMap/1Map has no photos yet,
-- persistNoPhotos sets photo_count=0 and leaves vlm_categorization_status='pending'.
-- Nothing re-fetches it: the auto-QA cron needs photo_count>0, and the
-- retry-categorizations cron only handles 'failed'/'processing'/'categorized'-with-errors.
-- So a DR whose photos sync to 1Map *after* the initial webhook's ~1-min retries
-- is stranded at pending/0-photos forever (invisible to every cron).
--
-- Fix: /api/cron/refetch-missing-photos re-attempts the photo fetch for recent
-- no-photo DRs, bounded by these columns:
--   * photo_refetch_attempts — number of re-fetch attempts (capped, so a genuinely
--                              absent install is not retried forever)
--   * photo_refetch_next_at  — earliest time for the next attempt (spaced backoff)
--
-- Additive and idempotent — safe to re-run.

ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN IF NOT EXISTS photo_refetch_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS photo_refetch_next_at  TIMESTAMPTZ;

-- Keeps the every-5-min cron scan cheap: only the small set of stranded
-- no-photo DRs is indexed, not the whole reviews table.
CREATE INDEX IF NOT EXISTS idx_dr_photo_refetch_pending
  ON dr_photo_unified_reviews (wa_received_at)
  WHERE vlm_categorization_status = 'pending'
    AND (photo_count = 0 OR photo_count IS NULL);

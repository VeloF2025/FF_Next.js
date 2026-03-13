-- Migration 242: Auto-QA Pipeline Columns
-- Adds columns to support automated QA processing of DRs

-- Auto-QA processing status
ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN IF NOT EXISTS auto_qa_processed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_qa_processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_qa_results JSONB,
  ADD COLUMN IF NOT EXISTS auto_qa_eligible_at TIMESTAMPTZ;

-- Backfill eligible_at for existing DRs that have WhatsApp receipt time
UPDATE dr_photo_unified_reviews
SET auto_qa_eligible_at = wa_received_at + INTERVAL '30 minutes'
WHERE wa_received_at IS NOT NULL
  AND auto_qa_eligible_at IS NULL;

-- Index for the auto-QA cron to find eligible DRs efficiently
CREATE INDEX IF NOT EXISTS idx_unified_auto_qa_eligible
  ON dr_photo_unified_reviews (auto_qa_eligible_at)
  WHERE auto_qa_processed = false
    AND photo_count > 0;

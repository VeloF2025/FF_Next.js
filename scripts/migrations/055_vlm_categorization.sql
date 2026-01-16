-- Migration: Add VLM Photo Categorization Support
-- Purpose: Enable VLM-based photo categorization workflow
--
-- Problem: Field workers upload photos to incorrect attributes in OneMap.
-- Solution: Download ALL photos without pre-categorization, let VLM predict
--           categories, then human approves (Phase 1) or auto-approve (Phase 2).
--
-- Migration executed: 2026-01-16
-- Status: PENDING

-- Add VLM categorization columns to dr_photo_unified_reviews
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS vlm_categorization_status VARCHAR(50) DEFAULT 'pending';
-- Status values: 'pending' | 'processing' | 'categorized' | 'approved' | 'failed'

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS vlm_categorization_results JSONB DEFAULT '[]'::jsonb;
-- Array of VlmCategorizationResult objects:
-- {
--   photo_filename: string,
--   original_type: string | null,
--   original_step: number | null,
--   vlm_predicted_category: string,
--   vlm_predicted_step: number,
--   vlm_confidence: number (0-1),
--   vlm_identified_as: string,
--   vlm_reasoning: string,
--   human_approved: boolean | null,
--   human_override_step: number | null,
--   human_override_reason: string | null
-- }

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS vlm_categorized_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS vlm_approved_by TEXT;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS vlm_approved_at TIMESTAMP WITH TIME ZONE;

-- Add column comments
COMMENT ON COLUMN dr_photo_unified_reviews.vlm_categorization_status IS 'VLM categorization workflow status: pending, processing, categorized, approved, failed';
COMMENT ON COLUMN dr_photo_unified_reviews.vlm_categorization_results IS 'JSON array of VLM photo categorization predictions and human approvals';
COMMENT ON COLUMN dr_photo_unified_reviews.vlm_categorized_at IS 'Timestamp when VLM categorization completed';
COMMENT ON COLUMN dr_photo_unified_reviews.vlm_approved_by IS 'User who approved the VLM categorization';
COMMENT ON COLUMN dr_photo_unified_reviews.vlm_approved_at IS 'Timestamp when human approved the categorization';

-- Create index for filtering by categorization status
CREATE INDEX IF NOT EXISTS idx_dr_unified_vlm_status
ON dr_photo_unified_reviews(vlm_categorization_status);

-- Create index for finding unapproved categorizations
CREATE INDEX IF NOT EXISTS idx_dr_unified_vlm_pending
ON dr_photo_unified_reviews(vlm_categorization_status)
WHERE vlm_categorization_status IN ('categorized', 'processing');

-- Add retry tracking columns for failed categorizations
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS vlm_retry_count INTEGER DEFAULT 0;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS vlm_last_error TEXT;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS vlm_next_retry_at TIMESTAMP WITH TIME ZONE;

-- Add column comments for retry tracking
COMMENT ON COLUMN dr_photo_unified_reviews.vlm_retry_count IS 'Number of retry attempts for failed VLM categorization';
COMMENT ON COLUMN dr_photo_unified_reviews.vlm_last_error IS 'Last error message from failed VLM categorization';
COMMENT ON COLUMN dr_photo_unified_reviews.vlm_next_retry_at IS 'Scheduled time for next retry attempt';

-- Create index for retry queue
CREATE INDEX IF NOT EXISTS idx_dr_unified_vlm_retry
ON dr_photo_unified_reviews(vlm_next_retry_at)
WHERE vlm_categorization_status = 'failed' AND vlm_retry_count < 5;

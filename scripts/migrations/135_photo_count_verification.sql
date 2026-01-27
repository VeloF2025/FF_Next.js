-- Migration 135: Add photo count verification tracking
-- Tracks when photo counts were last verified against 1Map

-- Add verification timestamp column
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS photo_count_verified_at TIMESTAMPTZ;

-- Add column to track if there's a mismatch (for reporting)
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS photo_count_mismatch BOOLEAN DEFAULT FALSE;

-- Add comment explaining the columns
COMMENT ON COLUMN dr_photo_unified_reviews.photo_count_verified_at IS 'When photo_count was last verified against 1Map actual downloadable photos';
COMMENT ON COLUMN dr_photo_unified_reviews.photo_count_mismatch IS 'True if DB photo_count differs from 1Map available count';

-- Create index for finding unverified or mismatched records
CREATE INDEX IF NOT EXISTS idx_unified_photo_verification
ON dr_photo_unified_reviews (photo_count_verified_at, photo_count_mismatch)
WHERE photo_count > 0;

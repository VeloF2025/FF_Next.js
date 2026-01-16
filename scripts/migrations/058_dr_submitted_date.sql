-- Migration 058: Add submitted_date field for DR Photo Unified
-- Purpose: Track when DR was originally submitted (may differ from created_at when adding retroactively)
-- Date: 2026-01-16

-- Add submitted_date column
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS submitted_date DATE;

-- Set default for existing records to the date portion of created_at
UPDATE dr_photo_unified_reviews
SET submitted_date = DATE(created_at)
WHERE submitted_date IS NULL;

-- Add index for date-based queries and filtering
CREATE INDEX IF NOT EXISTS idx_dr_unified_submitted_date
ON dr_photo_unified_reviews(submitted_date);

-- Comment on column
COMMENT ON COLUMN dr_photo_unified_reviews.submitted_date IS 'Date when DR was originally submitted (for retroactive entries, may differ from created_at)';

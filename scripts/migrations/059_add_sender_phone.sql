-- Migration 059: Add sender_phone to DR Photo Unified Reviews
-- Purpose: Track the WhatsApp sender phone number for agent identification
-- Date: 2026-01-16

-- Add sender_phone column
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS sender_phone VARCHAR(50);

-- Add index for agent-based queries
CREATE INDEX IF NOT EXISTS idx_dr_unified_sender_phone
ON dr_photo_unified_reviews(sender_phone)
WHERE sender_phone IS NOT NULL;

-- Backfill sender_phone from qa_photo_reviews for existing records
UPDATE dr_photo_unified_reviews u
SET sender_phone = q.sender_phone
FROM qa_photo_reviews q
WHERE u.drop_number = q.drop_number
  AND u.sender_phone IS NULL
  AND q.sender_phone IS NOT NULL;

-- Comment on column
COMMENT ON COLUMN dr_photo_unified_reviews.sender_phone IS 'WhatsApp sender phone number from WA Monitor for agent identification';

-- Report results
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO updated_count
  FROM dr_photo_unified_reviews
  WHERE sender_phone IS NOT NULL;

  RAISE NOTICE 'Migration 059 complete: % records now have sender_phone populated', updated_count;
END $$;

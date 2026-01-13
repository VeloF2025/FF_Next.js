-- Migration 036: Staff Photo Fields
-- Adds fields for ID photo extraction and profile photo comparison

-- Add photo-related columns to staff table
ALTER TABLE staff ADD COLUMN IF NOT EXISTS id_photo_url TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS photo_match_score DECIMAL(5,2);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS photo_verified_at TIMESTAMP;

-- Add index for photo verification queries
CREATE INDEX IF NOT EXISTS idx_staff_photo_verified
ON staff(photo_verified_at)
WHERE photo_verified_at IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN staff.id_photo_url IS 'Photo extracted from ID document (SA ID or Passport) via OCR';
COMMENT ON COLUMN staff.profile_photo_url IS 'Manually uploaded profile photo for comparison';
COMMENT ON COLUMN staff.photo_match_score IS 'AI face comparison score (0-100%)';
COMMENT ON COLUMN staff.photo_verified_at IS 'Timestamp of last photo comparison';

-- Migration 145: OneMap Status Tracking
-- Tracks whether a DR exists in 1Map at time of WhatsApp submission
-- Enables ack messages for DRs in our drops table but not yet in 1Map

-- Add onemap_status column to unified reviews
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS onemap_status VARCHAR(20) DEFAULT NULL;

-- Add onemap_checked_at to track when we last checked 1Map
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS onemap_checked_at TIMESTAMPTZ DEFAULT NULL;

-- Values for onemap_status:
--   NULL         = not checked yet (legacy records)
--   'found'      = DR exists in 1Map
--   'not_found'  = DR exists in drops table but NOT in 1Map
--   'resolved'   = Was not_found, now found in 1Map (after re-check)

-- Index for efficient re-check queries
CREATE INDEX IF NOT EXISTS idx_unified_onemap_status
ON dr_photo_unified_reviews (onemap_status)
WHERE onemap_status = 'not_found';

COMMENT ON COLUMN dr_photo_unified_reviews.onemap_status IS 'Whether DR was found in 1Map at submission time: found, not_found, resolved';
COMMENT ON COLUMN dr_photo_unified_reviews.onemap_checked_at IS 'When 1Map was last checked for this DR';

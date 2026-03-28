-- Migration: Add dome joint step columns (11 & 12) to dr_photo_unified_reviews
-- These track whether dome joint open/closed photos exist per DR
-- Matches existing step_01 through step_10 boolean pattern

ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN IF NOT EXISTS step_11_dome_joint_open BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS step_12_dome_joint_closed BOOLEAN DEFAULT false;

-- Backfill from existing photos_metadata: set true if ph_hh1/ph_hh2 exist
UPDATE dr_photo_unified_reviews
SET step_11_dome_joint_open = true
WHERE photos_metadata::text LIKE '%ph_hh1%';

UPDATE dr_photo_unified_reviews
SET step_12_dome_joint_closed = true
WHERE photos_metadata::text LIKE '%ph_hh2%';

-- Update total_steps from 10 to 12 where it exists
UPDATE dr_photo_unified_reviews
SET total_steps = 12
WHERE total_steps = 10;

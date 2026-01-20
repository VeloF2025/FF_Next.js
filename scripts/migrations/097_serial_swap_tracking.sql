-- Migration: 097_serial_swap_tracking.sql
-- Purpose: Add serial swap tracking fields for 1Map correction workflow
-- Date: 2026-01-20
--
-- When ONT and UPS serials are entered in wrong fields in 1Map,
-- this tracks detection, status, and resolution.
--
-- Serial Patterns:
--   ONT (Nokia): ALCL* or ALCB* (e.g., ALCLB48CC3CA)
--   UPS (Gizzu): GU18W* (e.g., GU18W12V2508057584)

-- Add swap tracking fields to dr_photo_unified_reviews
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS serial_swap_detected BOOLEAN DEFAULT FALSE;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS serial_swap_status VARCHAR(50) DEFAULT NULL;
-- Values: 'pending_correction', 'corrected_in_1map', 'false_positive'

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS serial_swap_details TEXT;
-- Human-readable description of the swap

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS serial_swap_detected_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS serial_swap_corrected_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS serial_swap_corrected_by TEXT;

-- Also add to foto_ai_reviews for consistency
ALTER TABLE foto_ai_reviews
ADD COLUMN IF NOT EXISTS serial_swap_detected BOOLEAN DEFAULT FALSE;

ALTER TABLE foto_ai_reviews
ADD COLUMN IF NOT EXISTS serial_swap_status VARCHAR(50) DEFAULT NULL;

ALTER TABLE foto_ai_reviews
ADD COLUMN IF NOT EXISTS serial_swap_details TEXT;

ALTER TABLE foto_ai_reviews
ADD COLUMN IF NOT EXISTS serial_swap_detected_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE foto_ai_reviews
ADD COLUMN IF NOT EXISTS serial_swap_corrected_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE foto_ai_reviews
ADD COLUMN IF NOT EXISTS serial_swap_corrected_by TEXT;

-- Index for swap reports
CREATE INDEX IF NOT EXISTS idx_unified_serial_swap
ON dr_photo_unified_reviews(serial_swap_detected, serial_swap_status)
WHERE serial_swap_detected = TRUE;

CREATE INDEX IF NOT EXISTS idx_foto_ai_serial_swap
ON foto_ai_reviews(serial_swap_detected, serial_swap_status)
WHERE serial_swap_detected = TRUE;

-- Add comments
DO $$
BEGIN
  COMMENT ON COLUMN dr_photo_unified_reviews.serial_swap_detected IS 'True if ONT/UPS serials appear to be in wrong fields';
  COMMENT ON COLUMN dr_photo_unified_reviews.serial_swap_status IS 'pending_correction | corrected_in_1map | false_positive';
  COMMENT ON COLUMN dr_photo_unified_reviews.serial_swap_details IS 'Human-readable swap description';
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

-- Verification
DO $$
DECLARE
  col_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_name = 'dr_photo_unified_reviews'
    AND column_name LIKE 'serial_swap%';

  IF col_count >= 5 THEN
    RAISE NOTICE '✅ Migration 097: Serial swap tracking columns added (% columns)', col_count;
  ELSE
    RAISE WARNING '⚠️ Expected 6 serial_swap columns, found %', col_count;
  END IF;
END $$;

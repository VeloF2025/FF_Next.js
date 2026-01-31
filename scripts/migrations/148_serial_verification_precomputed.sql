-- Migration 148: Add pre-computed serial verification columns
-- These store the 4-way verification badge (OES vs Offline vs 1Map vs WA Photo)
-- Separate from serial_validation_status which is QA Wizard 3-way check

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS serial_verification_status TEXT
  CHECK (serial_verification_status IN ('gold','silver','bronze','warning','none')),
ADD COLUMN IF NOT EXISTS serial_verification_label TEXT,
ADD COLUMN IF NOT EXISTS serial_verification_details JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS serial_verification_computed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_unified_serial_verification
ON dr_photo_unified_reviews(serial_verification_status)
WHERE serial_verification_status IS NOT NULL;

-- Migration 100: Fix OES activation timestamp and separate Installed vs Activated
--
-- Issues being fixed:
-- 1. activation_date is DATE only, losing timestamp precision
-- 2. OES-only DRs incorrectly get submitted_date set, inflating "Installed" count
-- 3. No activity log entries for OES activation events
--
-- Changes:
-- 1. Add activation_datetime column to oes_activations (TIMESTAMPTZ)
-- 2. Add is_oes_only flag to dr_photo_unified_reviews to track source
-- 3. Clear submitted_date for OES-only records (they weren't "submitted")

-- Step 1: Add activation_datetime column to oes_activations
ALTER TABLE oes_activations
ADD COLUMN IF NOT EXISTS activation_datetime TIMESTAMP WITH TIME ZONE;

-- Step 2: Copy existing dates to new column (at midnight)
UPDATE oes_activations
SET activation_datetime = activation_date::TIMESTAMP WITH TIME ZONE
WHERE activation_datetime IS NULL AND activation_date IS NOT NULL;

-- Step 3: Add is_oes_only flag to dr_photo_unified_reviews
-- This tracks whether the DR came from OES import only (no WhatsApp submission)
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS is_oes_only BOOLEAN DEFAULT FALSE;

-- Step 4: Mark OES-only records (photo_source = 'OES Import' and no WA data)
UPDATE dr_photo_unified_reviews
SET is_oes_only = TRUE
WHERE photo_source = 'OES Import'
  AND (wa_received_at IS NULL OR wa_message_id IS NULL);

-- Step 5: Clear submitted_date for OES-only records
-- These DRs were never "submitted" via WhatsApp, only activated in OES
-- The submitted_date was incorrectly set to the activation date
UPDATE dr_photo_unified_reviews
SET submitted_date = NULL
WHERE is_oes_only = TRUE;

-- Step 6: Create index for faster OES-only queries
CREATE INDEX IF NOT EXISTS idx_unified_is_oes_only
ON dr_photo_unified_reviews(is_oes_only)
WHERE is_oes_only = TRUE;

-- Step 7: Add comments for documentation
COMMENT ON COLUMN oes_activations.activation_datetime IS 'Full activation timestamp from OES report (Jan 2026)';
COMMENT ON COLUMN dr_photo_unified_reviews.is_oes_only IS 'TRUE if DR came from OES import only, no WhatsApp submission';

-- Verify changes
SELECT
  'OES-only records' as metric,
  COUNT(*) as count
FROM dr_photo_unified_reviews
WHERE is_oes_only = TRUE

UNION ALL

SELECT
  'OES-only with NULL submitted_date' as metric,
  COUNT(*) as count
FROM dr_photo_unified_reviews
WHERE is_oes_only = TRUE AND submitted_date IS NULL;

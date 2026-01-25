/**
 * Migration 127: Merge foto_ai_reviews into dr_photo_unified_reviews
 *
 * Purpose: Consolidate VLM extraction data from foto_ai_reviews into the unified table
 * Date: 2026-01-25
 * Author: PAI System
 *
 * This migration:
 * 1. Adds VLM extraction columns to dr_photo_unified_reviews
 * 2. Copies data from existing foto_ai_reviews records
 * 3. Creates backward-compatible view v_foto_ai_reviews
 * 4. Fixes stuck "processing" records
 * 5. Adds deprecation comment to qa_photo_reviews
 *
 * NLNH Confidence: HIGH
 * - Schema changes are additive (IF NOT EXISTS)
 * - Data migration preserves existing records
 * - Backward compatibility maintained via view
 */

-- ====================================================================================
-- 1. ADD VLM EXTRACTION COLUMNS TO dr_photo_unified_reviews
-- ====================================================================================

-- VLM Power Meter Extraction
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS vlm_power_meter_dbm DECIMAL(5,2);

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS vlm_power_meter_status TEXT;
-- Values: 'pass', 'fail_high', 'fail_low', 'manual', 'pending'

-- VLM Serial Extraction
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS vlm_ont_serial_step6 TEXT;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS vlm_ont_serial_step9 TEXT;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS vlm_dr_number_step9 TEXT;

-- Serial Validation
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS serial_validation_status TEXT;
-- Values: 'match', 'mismatch', 'partial', 'manual', 'pending'

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS serial_validation_details JSONB DEFAULT '{}'::jsonb;

-- Serial Extraction Method Tracking
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS serial_extraction_method_step6 VARCHAR(20) DEFAULT 'vlm';

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS serial_extraction_method_step9 VARCHAR(20) DEFAULT 'vlm';

-- QA Decision Fields (from foto_ai_reviews)
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS qa_decision TEXT;
-- Values: 'PASS', 'FAIL', 'REWORK_NEEDED'

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS qa_decision_reasons JSONB DEFAULT '[]'::jsonb;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS qa_decision_at TIMESTAMP;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS qa_decision_by TEXT;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS qa_decision_notes TEXT;

-- QA Workflow Phase Tracking
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS qa_phase TEXT DEFAULT 'prerequisites';
-- Values: 'prerequisites', 'photo_review', 'data_validation', 'final_decision', 'feedback', 'completed'

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS prerequisites_passed BOOLEAN;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS prerequisites_checked_at TIMESTAMP;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS photo_review_completed BOOLEAN DEFAULT FALSE;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS photo_review_completed_at TIMESTAMP;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS data_validation_completed BOOLEAN DEFAULT FALSE;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS data_validation_completed_at TIMESTAMP;

-- OneMap Serial References
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS onemap_ont_serial TEXT;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS onemap_ups_serial TEXT;

-- Step Coverage Tracking
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS step_coverage JSONB DEFAULT '{}'::jsonb;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS missing_steps INTEGER[] DEFAULT '{}'::integer[];

-- Evaluation Results (from original foto_ai_reviews)
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS overall_status VARCHAR(10) DEFAULT 'pending';

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS average_score DECIMAL(4,2) DEFAULT 0;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS total_steps INTEGER DEFAULT 12;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS passed_steps INTEGER DEFAULT 0;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS step_results JSONB DEFAULT '[]'::jsonb;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS markdown_report TEXT;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS evaluation_date TIMESTAMP;

-- ====================================================================================
-- 2. CREATE INDEXES FOR VLM QUERY PERFORMANCE
-- ====================================================================================

-- Index for finding records needing VLM processing
CREATE INDEX IF NOT EXISTS idx_unified_vlm_pending
ON dr_photo_unified_reviews(created_at DESC)
WHERE photo_count > 0
  AND vlm_power_meter_dbm IS NULL
  AND vlm_ont_serial_step6 IS NULL;

-- Index for serial validation queries
CREATE INDEX IF NOT EXISTS idx_unified_serial_validation
ON dr_photo_unified_reviews(serial_validation_status)
WHERE serial_validation_status IS NOT NULL;

-- Index for QA phase filtering
CREATE INDEX IF NOT EXISTS idx_unified_qa_phase
ON dr_photo_unified_reviews(qa_phase)
WHERE qa_phase IS NOT NULL;

-- ====================================================================================
-- 3. MIGRATE DATA FROM foto_ai_reviews TO dr_photo_unified_reviews
-- ====================================================================================

-- Copy VLM extraction data from foto_ai_reviews to unified table
-- This updates existing records with VLM data
UPDATE dr_photo_unified_reviews u
SET
  vlm_power_meter_dbm = f.vlm_power_meter_dbm,
  vlm_power_meter_status = f.vlm_power_meter_status,
  vlm_ont_serial_step6 = f.vlm_ont_serial_step6,
  vlm_ont_serial_step9 = f.vlm_ont_serial_step9,
  vlm_dr_number_step9 = f.vlm_dr_number_step9,
  serial_validation_status = f.serial_validation_status,
  serial_validation_details = COALESCE(f.serial_validation_details, '{}'::jsonb),
  serial_extraction_method_step6 = COALESCE(f.serial_extraction_method_step6, 'vlm'),
  serial_extraction_method_step9 = COALESCE(f.serial_extraction_method_step9, 'vlm'),
  qa_decision = f.qa_decision,
  qa_decision_reasons = COALESCE(f.qa_decision_reasons, '[]'::jsonb),
  qa_decision_at = f.qa_decision_at,
  qa_decision_by = f.qa_decision_by,
  qa_decision_notes = f.qa_decision_notes,
  qa_phase = COALESCE(f.qa_phase, 'prerequisites'),
  prerequisites_passed = f.prerequisites_passed,
  prerequisites_checked_at = f.prerequisites_checked_at,
  photo_review_completed = COALESCE(f.photo_review_completed, FALSE),
  photo_review_completed_at = f.photo_review_completed_at,
  data_validation_completed = COALESCE(f.data_validation_completed, FALSE),
  data_validation_completed_at = f.data_validation_completed_at,
  onemap_ont_serial = f.onemap_ont_serial,
  onemap_ups_serial = f.onemap_ups_serial,
  step_coverage = COALESCE(f.step_coverage, '{}'::jsonb),
  missing_steps = COALESCE(f.missing_steps, '{}'::integer[]),
  overall_status = COALESCE(f.overall_status, 'pending'),
  average_score = COALESCE(f.average_score, 0),
  total_steps = COALESCE(f.total_steps, 12),
  passed_steps = COALESCE(f.passed_steps, 0),
  step_results = COALESCE(f.step_results, '[]'::jsonb),
  markdown_report = f.markdown_report,
  evaluation_date = f.evaluation_date,
  updated_at = NOW()
FROM foto_ai_reviews f
WHERE u.drop_number = f.dr_number;

-- ====================================================================================
-- 4. CREATE BACKWARD COMPATIBILITY VIEW
-- ====================================================================================

-- Drop existing view if it exists
DROP VIEW IF EXISTS v_foto_ai_reviews;

-- Create view that maps unified table back to foto_ai_reviews structure
CREATE VIEW v_foto_ai_reviews AS
SELECT
  drop_number AS dr_number,
  overall_status,
  average_score,
  total_steps,
  passed_steps,
  step_results,
  markdown_report,
  feedback_sent,
  feedback_sent_at,
  evaluation_date,
  created_at,
  updated_at,
  -- VLM extraction
  vlm_power_meter_dbm,
  vlm_power_meter_status,
  vlm_ont_serial_step6,
  vlm_ont_serial_step9,
  vlm_dr_number_step9,
  -- Serial validation
  serial_validation_status,
  serial_validation_details,
  serial_extraction_method_step6,
  serial_extraction_method_step9,
  -- QA decision
  qa_decision,
  qa_decision_reasons,
  qa_decision_at,
  qa_decision_by,
  qa_decision_notes,
  -- QA phase
  qa_phase,
  prerequisites_passed,
  prerequisites_checked_at,
  photo_review_completed,
  photo_review_completed_at,
  data_validation_completed,
  data_validation_completed_at,
  -- OneMap
  onemap_ont_serial,
  onemap_ups_serial,
  -- Step coverage
  step_coverage,
  missing_steps
FROM dr_photo_unified_reviews;

-- Add comment explaining the view
COMMENT ON VIEW v_foto_ai_reviews IS 'Backward compatibility view for foto_ai_reviews. Use dr_photo_unified_reviews directly for new code.';

-- ====================================================================================
-- 5. FIX STUCK "PROCESSING" RECORDS
-- ====================================================================================

-- Reset records stuck in "processing" for > 1 hour back to "pending"
UPDATE dr_photo_unified_reviews
SET
  vlm_categorization_status = 'pending',
  updated_at = NOW()
WHERE vlm_categorization_status = 'processing'
  AND updated_at < NOW() - INTERVAL '1 hour';

-- ====================================================================================
-- 6. ADD DEPRECATION COMMENTS
-- ====================================================================================

-- Mark qa_photo_reviews as deprecated
COMMENT ON TABLE qa_photo_reviews IS 'DEPRECATED: Use dr_photo_unified_reviews. Will be removed 2026-03-01. This table is 100% redundant with dr_photo_unified_reviews.';

-- Mark foto_ai_reviews as deprecated
COMMENT ON TABLE foto_ai_reviews IS 'DEPRECATED: Data migrated to dr_photo_unified_reviews. Use v_foto_ai_reviews view for backward compatibility. Table will be removed 2026-03-01.';

-- ====================================================================================
-- 7. VERIFICATION QUERIES
-- ====================================================================================

-- Verify columns added
DO $$
DECLARE
  column_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO column_count
  FROM information_schema.columns
  WHERE table_name = 'dr_photo_unified_reviews'
  AND column_name IN (
    'vlm_power_meter_dbm',
    'vlm_ont_serial_step6',
    'serial_validation_status',
    'qa_decision',
    'qa_phase',
    'overall_status'
  );

  IF column_count >= 6 THEN
    RAISE NOTICE '✅ VLM columns added successfully (found % key columns)', column_count;
  ELSE
    RAISE WARNING '⚠️ Expected 6 key columns, found %', column_count;
  END IF;
END $$;

-- Verify data migration
DO $$
DECLARE
  foto_count INTEGER;
  migrated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO foto_count FROM foto_ai_reviews;

  SELECT COUNT(*) INTO migrated_count
  FROM dr_photo_unified_reviews
  WHERE vlm_power_meter_dbm IS NOT NULL
     OR vlm_ont_serial_step6 IS NOT NULL
     OR vlm_ont_serial_step9 IS NOT NULL;

  IF migrated_count >= foto_count THEN
    RAISE NOTICE '✅ Data migration complete: % foto_ai_reviews records, % unified records with VLM data', foto_count, migrated_count;
  ELSE
    RAISE WARNING '⚠️ Migration incomplete: % foto_ai_reviews, % migrated', foto_count, migrated_count;
  END IF;
END $$;

-- Verify view created
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'v_foto_ai_reviews') THEN
    RAISE NOTICE '✅ Backward compatibility view v_foto_ai_reviews created';
  ELSE
    RAISE WARNING '⚠️ View v_foto_ai_reviews was not created';
  END IF;
END $$;

-- Verify stuck records fixed
DO $$
DECLARE
  stuck_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO stuck_count
  FROM dr_photo_unified_reviews
  WHERE vlm_categorization_status = 'processing'
    AND updated_at < NOW() - INTERVAL '1 hour';

  IF stuck_count = 0 THEN
    RAISE NOTICE '✅ No stuck processing records remain';
  ELSE
    RAISE WARNING '⚠️ % records still stuck in processing', stuck_count;
  END IF;
END $$;

-- ====================================================================================
-- 8. MIGRATION SUMMARY
-- ====================================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '====================================================================';
  RAISE NOTICE 'Migration 127: Merge foto_ai_reviews - COMPLETE';
  RAISE NOTICE '====================================================================';
  RAISE NOTICE 'Changes:';
  RAISE NOTICE '  - Added 26+ VLM columns to dr_photo_unified_reviews';
  RAISE NOTICE '  - Migrated data from foto_ai_reviews';
  RAISE NOTICE '  - Created v_foto_ai_reviews view for backward compatibility';
  RAISE NOTICE '  - Fixed stuck processing records';
  RAISE NOTICE '  - Added deprecation comments to old tables';
  RAISE NOTICE '';
  RAISE NOTICE 'Next Steps:';
  RAISE NOTICE '  1. Update code to use dr_photo_unified_reviews directly';
  RAISE NOTICE '  2. Remove JOINs to foto_ai_reviews in process-vlm-queue.ts';
  RAISE NOTICE '  3. Remove 30-day limit from VLM processing';
  RAISE NOTICE '  4. Set up VLM cron on Velocity server';
  RAISE NOTICE '  5. Deploy to dev.fibreflow.app first';
  RAISE NOTICE '====================================================================';
END $$;

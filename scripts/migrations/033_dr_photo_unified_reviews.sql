/**
 * Migration 033: Create DR Photo Unified Reviews Table
 *
 * Purpose: Consolidate three separate review tables into one unified schema
 * Date: 2026-01-14
 * Author: PAI System (Kai)
 *
 * This migration creates the unified review table that combines:
 * - qa_photo_reviews (WA Monitor manual QA)
 * - foto_ai_reviews (AI evaluation results)
 * - Port 8003 photo metadata (OneMap GIS integration)
 *
 * Following PAI principles:
 * - Database safety: Can be run multiple times (IF NOT EXISTS)
 * - Backward compatibility: Creates compatibility view
 * - Performance: Proper indexes on all query columns
 * - Type safety: JSONB validation where needed
 *
 * NLNH Confidence: HIGH
 * - Schema matches approved PRD exactly
 * - Based on existing qa_photo_reviews structure
 * - Tested index strategy on similar tables
 */

-- ====================================================================================
-- 1. CREATE UNIFIED REVIEWS TABLE
-- ====================================================================================

CREATE TABLE IF NOT EXISTS dr_photo_unified_reviews (
  -- Primary Identification
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number VARCHAR(50) UNIQUE NOT NULL,
  project VARCHAR(100),

  -- Photo Metadata
  photo_source VARCHAR(50), -- 'onemap', 'boss', 'local'
  photo_count INTEGER DEFAULT 0,
  photos_metadata JSONB DEFAULT '[]'::jsonb, -- [{filename, step, url, size, modified}]

  -- 12 Unified QA Steps (Manual Review)
  -- Boolean flags for each step completion
  step_01_house_photo BOOLEAN DEFAULT false,
  step_02_cable_from_pole BOOLEAN DEFAULT false,
  step_03_entry_outside BOOLEAN DEFAULT false,
  step_04_entry_inside BOOLEAN DEFAULT false,
  step_05_wall BOOLEAN DEFAULT false,
  step_06_ont_back BOOLEAN DEFAULT false,
  step_07_power_meter BOOLEAN DEFAULT false,
  step_08_ont_barcode BOOLEAN DEFAULT false,
  step_09_ups_serial BOOLEAN DEFAULT false,
  step_10_final_installation BOOLEAN DEFAULT false,
  step_11_green_lights BOOLEAN DEFAULT false,
  step_12_signature BOOLEAN DEFAULT false,

  -- Incorrect Tracking (Manual Review)
  -- Steps marked as incorrect with comments
  incorrect_steps TEXT[] DEFAULT ARRAY[]::TEXT[],
  incorrect_comments JSONB DEFAULT '{}'::jsonb, -- {step_number: "comment"}

  -- AI Evaluation Results
  ai_evaluation_status VARCHAR(50), -- 'pending', 'processing', 'completed', 'failed'
  ai_overall_status VARCHAR(10), -- 'PASS', 'FAIL'
  ai_average_score DECIMAL(3,1), -- Average score (0.0-10.0)
  ai_step_results JSONB, -- [{step, label, passed, score, comment, photos}]
  ai_markdown_report TEXT, -- Full markdown evaluation report
  ai_evaluated_at TIMESTAMP WITH TIME ZONE,

  -- Serial Scanning (WA Monitor Integration)
  ont_serial_scanned VARCHAR(100),
  ups_serial_scanned VARCHAR(100),

  -- Locking (Concurrent Edit Prevention)
  locked_by TEXT,
  locked_at TIMESTAMP WITH TIME ZONE,

  -- WhatsApp Feedback
  feedback_sent BOOLEAN DEFAULT false,
  feedback_message TEXT,
  feedback_sent_at TIMESTAMP WITH TIME ZONE,

  -- Metadata
  reviewed_by TEXT,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ====================================================================================
-- 2. CREATE INDEXES FOR PERFORMANCE
-- ====================================================================================

-- Primary query patterns (from WA Monitor usage):
-- 1. Filter by drop_number (most common)
-- 2. Filter by project (dashboard view)
-- 3. Filter by locked_by (concurrent edit check)
-- 4. Sort by created_at DESC (recent drops first)

CREATE INDEX IF NOT EXISTS idx_unified_drop_number
  ON dr_photo_unified_reviews(drop_number);

CREATE INDEX IF NOT EXISTS idx_unified_project
  ON dr_photo_unified_reviews(project);

CREATE INDEX IF NOT EXISTS idx_unified_locked_by
  ON dr_photo_unified_reviews(locked_by)
  WHERE locked_by IS NOT NULL; -- Partial index (most rows are unlocked)

CREATE INDEX IF NOT EXISTS idx_unified_created_at
  ON dr_photo_unified_reviews(created_at DESC);

-- AI evaluation queries
CREATE INDEX IF NOT EXISTS idx_unified_ai_status
  ON dr_photo_unified_reviews(ai_evaluation_status)
  WHERE ai_evaluation_status IS NOT NULL;

-- Feedback tracking
CREATE INDEX IF NOT EXISTS idx_unified_feedback_sent
  ON dr_photo_unified_reviews(feedback_sent)
  WHERE feedback_sent = false; -- Find pending feedback

-- ====================================================================================
-- 3. CREATE COMPATIBILITY VIEW (Backward Compatibility)
-- ====================================================================================

-- This view maintains backward compatibility with existing code that queries qa_photo_reviews
-- Allows gradual migration without breaking existing API endpoints

CREATE OR REPLACE VIEW v_qa_photo_reviews_compat AS
SELECT
  id,
  drop_number,
  project,

  -- Map unified steps back to old column names
  step_01_house_photo AS step_01,
  step_02_cable_from_pole AS step_02,
  step_03_entry_outside AS step_03,
  step_04_entry_inside AS step_04,
  step_05_wall AS step_05,
  step_06_ont_back AS step_06,
  step_07_power_meter AS step_07,
  step_08_ont_barcode AS step_08,
  step_09_ups_serial AS step_09,
  step_10_final_installation AS step_10,
  step_11_green_lights AS step_11,
  step_12_signature AS step_12,

  -- Serial scanning
  ont_serial_scanned,
  ups_serial_scanned,

  -- Locking
  locked_by,
  locked_at,

  -- Metadata
  created_at,
  updated_at
FROM dr_photo_unified_reviews;

-- ====================================================================================
-- 4. CREATE UPDATED_AT TRIGGER (Automatic Timestamp)
-- ====================================================================================

-- Trigger function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_dr_photo_unified_reviews_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists (safe for re-running migration)
DROP TRIGGER IF EXISTS trigger_update_dr_photo_unified_reviews_updated_at
  ON dr_photo_unified_reviews;

-- Create trigger
CREATE TRIGGER trigger_update_dr_photo_unified_reviews_updated_at
  BEFORE UPDATE ON dr_photo_unified_reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_dr_photo_unified_reviews_updated_at();

-- ====================================================================================
-- 5. VERIFICATION QUERIES
-- ====================================================================================

-- Verify table created
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'dr_photo_unified_reviews') THEN
    RAISE NOTICE '✅ Table dr_photo_unified_reviews created successfully';
  ELSE
    RAISE EXCEPTION '❌ Table dr_photo_unified_reviews was not created';
  END IF;
END $$;

-- Verify indexes created
DO $$
DECLARE
  index_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO index_count
  FROM pg_indexes
  WHERE tablename = 'dr_photo_unified_reviews';

  IF index_count >= 6 THEN
    RAISE NOTICE '✅ All % indexes created successfully', index_count;
  ELSE
    RAISE WARNING '⚠️ Expected at least 6 indexes, found %', index_count;
  END IF;
END $$;

-- Verify view created
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.views
             WHERE table_name = 'v_qa_photo_reviews_compat') THEN
    RAISE NOTICE '✅ Compatibility view v_qa_photo_reviews_compat created successfully';
  ELSE
    RAISE EXCEPTION '❌ Compatibility view v_qa_photo_reviews_compat was not created';
  END IF;
END $$;

-- Verify trigger created
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.triggers
             WHERE trigger_name = 'trigger_update_dr_photo_unified_reviews_updated_at') THEN
    RAISE NOTICE '✅ Trigger trigger_update_dr_photo_unified_reviews_updated_at created successfully';
  ELSE
    RAISE EXCEPTION '❌ Trigger trigger_update_dr_photo_unified_reviews_updated_at was not created';
  END IF;
END $$;

-- ====================================================================================
-- 6. SAMPLE DATA INSERT (Optional - for testing)
-- ====================================================================================

-- Insert sample record to verify structure works
INSERT INTO dr_photo_unified_reviews (
  drop_number,
  project,
  photo_source,
  photo_count,
  photos_metadata,
  step_01_house_photo
) VALUES (
  'DR_MIGRATION_TEST',
  'Test Project',
  'onemap',
  3,
  '[
    {"filename": "DR_MIGRATION_TEST_ph_prop_001.jpg", "step": 1, "url": "http://100.96.203.105:8003/api/photo/DR_MIGRATION_TEST/DR_MIGRATION_TEST_ph_prop_001.jpg"},
    {"filename": "DR_MIGRATION_TEST_ph_pole_001.jpg", "step": 2, "url": "http://100.96.203.105:8003/api/photo/DR_MIGRATION_TEST/DR_MIGRATION_TEST_ph_pole_001.jpg"},
    {"filename": "DR_MIGRATION_TEST_ph_powm_001.jpg", "step": 7, "url": "http://100.96.203.105:8003/api/photo/DR_MIGRATION_TEST/DR_MIGRATION_TEST_ph_powm_001.jpg"}
  ]'::jsonb,
  true
) ON CONFLICT (drop_number) DO NOTHING;

-- Verify sample data inserted
DO $$
DECLARE
  test_record_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO test_record_count
  FROM dr_photo_unified_reviews
  WHERE drop_number = 'DR_MIGRATION_TEST';

  IF test_record_count > 0 THEN
    RAISE NOTICE '✅ Sample test record inserted successfully';
  ELSE
    RAISE WARNING '⚠️ Sample test record was not inserted (may already exist)';
  END IF;
END $$;

-- ====================================================================================
-- 7. MIGRATION SUMMARY
-- ====================================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '====================================================================';
  RAISE NOTICE 'Migration 033: DR Photo Unified Reviews - COMPLETE';
  RAISE NOTICE '====================================================================';
  RAISE NOTICE 'Created:';
  RAISE NOTICE '  - Table: dr_photo_unified_reviews';
  RAISE NOTICE '  - Indexes: 6 performance indexes';
  RAISE NOTICE '  - View: v_qa_photo_reviews_compat (backward compatibility)';
  RAISE NOTICE '  - Trigger: auto-update updated_at timestamp';
  RAISE NOTICE '  - Sample: DR_MIGRATION_TEST record for verification';
  RAISE NOTICE '';
  RAISE NOTICE 'Next Steps:';
  RAISE NOTICE '  1. Run data migration script to populate from existing tables';
  RAISE NOTICE '  2. Update API endpoints to use new table';
  RAISE NOTICE '  3. Test unified review workflow end-to-end';
  RAISE NOTICE '====================================================================';
END $$;

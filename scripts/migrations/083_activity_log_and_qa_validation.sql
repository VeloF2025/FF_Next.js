-- Migration 083: Activity Log and QA Validation Enhancement
-- Purpose: Add activity tracking and separate VLM QA validation from categorization
-- Date: 2026-01-17
-- Author: PAI System
--
-- This migration adds:
-- 1. Activity log table for full DR lifecycle tracking
-- 2. New timestamp columns for event tracking
-- 3. VLM QA validation columns (separate from categorization)
-- 4. Human review tracking columns
--
-- NLNH Confidence: HIGH
-- Based on approved plan: wobbly-leaping-sparkle.md

-- ====================================================================================
-- 1. CREATE ACTIVITY LOG TABLE
-- ====================================================================================

CREATE TABLE IF NOT EXISTS dr_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number VARCHAR(50) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  -- Event types:
  -- 'whatsapp_submitted' - DR received via WhatsApp
  -- 'acknowledged' - Go Bridge sent acknowledgment reply
  -- 'photos_fetched' - Photos downloaded from OneMap
  -- 'categorization_started' - VLM categorization began
  -- 'categorization_complete' - VLM categorization finished
  -- 'qa_started' - VLM QA validation began
  -- 'qa_complete' - VLM QA validation finished
  -- 'human_review_started' - Human began reviewing
  -- 'human_review_complete' - Human finished all approvals
  -- 'feedback_generated' - Feedback message auto-generated
  -- 'feedback_sent' - Feedback sent to WhatsApp
  -- 'resubmission' - DR resubmitted after feedback
  event_data JSONB DEFAULT '{}'::jsonb,
  -- Event-specific data, e.g.:
  -- whatsapp_submitted: {phone_number, message_id, group_id}
  -- photos_fetched: {count, source, duration_ms}
  -- categorization_complete: {photos_categorized, unknown_count}
  -- qa_complete: {passed_count, failed_count, issues}
  -- human_review_complete: {approved_count, rejected_count, reviewer}
  actor VARCHAR(100), -- 'system', 'vlm', user_id, phone_number
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for activity log queries
CREATE INDEX IF NOT EXISTS idx_activity_log_drop
ON dr_activity_log(drop_number);

CREATE INDEX IF NOT EXISTS idx_activity_log_type
ON dr_activity_log(event_type);

CREATE INDEX IF NOT EXISTS idx_activity_log_created
ON dr_activity_log(created_at DESC);

-- Composite index for timeline queries
CREATE INDEX IF NOT EXISTS idx_activity_log_drop_created
ON dr_activity_log(drop_number, created_at DESC);

-- Add comment
COMMENT ON TABLE dr_activity_log IS 'Activity log for DR lifecycle events - tracks all actions from submission to feedback';

-- ====================================================================================
-- 2. ADD TIMESTAMP COLUMNS TO dr_photo_unified_reviews
-- ====================================================================================

-- WhatsApp submission timestamp
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS whatsapp_submitted_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN dr_photo_unified_reviews.whatsapp_submitted_at IS 'When DR was submitted via WhatsApp';

-- Acknowledgment timestamp
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN dr_photo_unified_reviews.acknowledged_at IS 'When Go Bridge sent acknowledgment reply';

-- Photos fetched timestamp
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS photos_fetched_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN dr_photo_unified_reviews.photos_fetched_at IS 'When photos were downloaded from OneMap';

-- ====================================================================================
-- 3. ADD VLM QA VALIDATION COLUMNS (Separate from categorization)
-- ====================================================================================

-- VLM QA validation status
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS vlm_qa_status VARCHAR(50) DEFAULT 'pending';
-- Status values: 'pending' | 'processing' | 'validated' | 'failed'

COMMENT ON COLUMN dr_photo_unified_reviews.vlm_qa_status IS 'VLM quality validation status: pending, processing, validated, failed';

-- VLM QA validation results
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS vlm_qa_results JSONB DEFAULT '[]'::jsonb;
-- Array of QA validation results per photo:
-- {
--   photo_filename: string,
--   step: number,
--   passed: boolean,
--   confidence: number (0-1),
--   issues: [{code, severity, description}],
--   comment: string (AI-generated explanation)
-- }

COMMENT ON COLUMN dr_photo_unified_reviews.vlm_qa_results IS 'JSON array of VLM QA validation results per photo with pass/fail and issues';

-- VLM QA validated timestamp
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS vlm_qa_validated_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN dr_photo_unified_reviews.vlm_qa_validated_at IS 'When VLM QA validation completed';

-- VLM QA summary
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS vlm_qa_summary JSONB;
-- Summary object:
-- {
--   total_photos: number,
--   passed_count: number,
--   failed_count: number,
--   issues_by_category: {category: count},
--   overall_passed: boolean
-- }

COMMENT ON COLUMN dr_photo_unified_reviews.vlm_qa_summary IS 'Summary of VLM QA validation results';

-- ====================================================================================
-- 4. ADD HUMAN REVIEW TRACKING COLUMNS
-- ====================================================================================

-- Human QA overrides
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS human_qa_overrides JSONB DEFAULT '[]'::jsonb;
-- Array of human override decisions:
-- {
--   photo_filename: string,
--   original_passed: boolean,
--   override_passed: boolean,
--   override_reason: string | null,
--   reviewer: string (user_id),
--   reviewed_at: timestamp
-- }

COMMENT ON COLUMN dr_photo_unified_reviews.human_qa_overrides IS 'JSON array of human override decisions for QA results';

-- Human review status
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS human_review_status VARCHAR(50) DEFAULT 'pending';
-- Status values: 'pending' | 'in_progress' | 'completed'

COMMENT ON COLUMN dr_photo_unified_reviews.human_review_status IS 'Human review workflow status: pending, in_progress, completed';

-- Human review completed timestamp
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS human_review_completed_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN dr_photo_unified_reviews.human_review_completed_at IS 'When human completed all photo reviews';

-- Human reviewer ID
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS human_reviewer_id TEXT;

COMMENT ON COLUMN dr_photo_unified_reviews.human_reviewer_id IS 'User ID of the human reviewer';

-- ====================================================================================
-- 5. CREATE INDEXES FOR NEW COLUMNS
-- ====================================================================================

-- Index for VLM QA status filtering
CREATE INDEX IF NOT EXISTS idx_dr_unified_vlm_qa_status
ON dr_photo_unified_reviews(vlm_qa_status);

-- Index for finding pending QA validations
CREATE INDEX IF NOT EXISTS idx_dr_unified_vlm_qa_pending
ON dr_photo_unified_reviews(vlm_qa_status)
WHERE vlm_qa_status IN ('pending', 'processing');

-- Index for human review status
CREATE INDEX IF NOT EXISTS idx_dr_unified_human_review_status
ON dr_photo_unified_reviews(human_review_status)
WHERE human_review_status != 'completed';

-- Index for finding DRs needing attention (pending QA or review)
CREATE INDEX IF NOT EXISTS idx_dr_unified_needs_attention
ON dr_photo_unified_reviews(created_at DESC)
WHERE vlm_qa_status = 'pending' OR human_review_status = 'pending';

-- ====================================================================================
-- 6. BACKFILL whatsapp_submitted_at FROM created_at
-- ====================================================================================

-- For existing records, set whatsapp_submitted_at = created_at
UPDATE dr_photo_unified_reviews
SET whatsapp_submitted_at = created_at
WHERE whatsapp_submitted_at IS NULL;

-- ====================================================================================
-- 7. VERIFICATION QUERIES
-- ====================================================================================

-- Verify activity log table created
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'dr_activity_log') THEN
    RAISE NOTICE '  Table dr_activity_log created successfully';
  ELSE
    RAISE EXCEPTION '  Table dr_activity_log was not created';
  END IF;
END $$;

-- Verify new columns added
DO $$
DECLARE
  col_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_name = 'dr_photo_unified_reviews'
    AND column_name IN (
      'whatsapp_submitted_at',
      'acknowledged_at',
      'photos_fetched_at',
      'vlm_qa_status',
      'vlm_qa_results',
      'vlm_qa_validated_at',
      'vlm_qa_summary',
      'human_qa_overrides',
      'human_review_status',
      'human_review_completed_at',
      'human_reviewer_id'
    );

  IF col_count >= 11 THEN
    RAISE NOTICE '  All 11 new columns added successfully';
  ELSE
    RAISE WARNING '  Expected 11 new columns, found %', col_count;
  END IF;
END $$;

-- Verify indexes created
DO $$
DECLARE
  idx_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO idx_count
  FROM pg_indexes
  WHERE tablename = 'dr_activity_log';

  IF idx_count >= 4 THEN
    RAISE NOTICE '  Activity log indexes created: %', idx_count;
  ELSE
    RAISE WARNING '  Expected at least 4 activity log indexes, found %', idx_count;
  END IF;
END $$;

-- ====================================================================================
-- 8. MIGRATION SUMMARY
-- ====================================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '====================================================================';
  RAISE NOTICE 'Migration 083: Activity Log and QA Validation - COMPLETE';
  RAISE NOTICE '====================================================================';
  RAISE NOTICE 'Created:';
  RAISE NOTICE '  - Table: dr_activity_log (lifecycle event tracking)';
  RAISE NOTICE '  - Columns: 11 new columns on dr_photo_unified_reviews';
  RAISE NOTICE '    - whatsapp_submitted_at, acknowledged_at, photos_fetched_at';
  RAISE NOTICE '    - vlm_qa_status, vlm_qa_results, vlm_qa_validated_at, vlm_qa_summary';
  RAISE NOTICE '    - human_qa_overrides, human_review_status, human_review_completed_at';
  RAISE NOTICE '    - human_reviewer_id';
  RAISE NOTICE '  - Indexes: 4 activity log + 4 QA filtering indexes';
  RAISE NOTICE '  - Backfill: whatsapp_submitted_at from created_at';
  RAISE NOTICE '';
  RAISE NOTICE 'Next Steps:';
  RAISE NOTICE '  1. Create activityLogService.ts';
  RAISE NOTICE '  2. Create vlmQaValidationService.ts';
  RAISE NOTICE '  3. Update API endpoints to log activities';
  RAISE NOTICE '====================================================================';
END $$;

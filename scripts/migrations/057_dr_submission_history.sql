-- Migration 057: Add submission history tracking for DR Photo Unified
-- Purpose: Track resubmissions with full history of previous photos and feedback
-- Date: 2026-01-16

-- Add submission tracking columns to dr_photo_unified_reviews
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS submission_count INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS submission_history JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS last_resubmitted_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS resubmitted_by TEXT;

-- Add index for faster duplicate lookups
CREATE INDEX IF NOT EXISTS idx_dr_unified_drop_number
ON dr_photo_unified_reviews(drop_number);

-- Add index for project-based queries
CREATE INDEX IF NOT EXISTS idx_dr_unified_project
ON dr_photo_unified_reviews(project);

-- Comment on columns
COMMENT ON COLUMN dr_photo_unified_reviews.submission_count IS 'Number of times this DR has been submitted (1 = original, 2+ = resubmissions)';
COMMENT ON COLUMN dr_photo_unified_reviews.submission_history IS 'Array of previous submission snapshots with photos, feedback, and timestamps';
COMMENT ON COLUMN dr_photo_unified_reviews.last_resubmitted_at IS 'Timestamp of the most recent resubmission';
COMMENT ON COLUMN dr_photo_unified_reviews.resubmitted_by IS 'Source of the most recent resubmission (manual_entry, wa_monitor, etc.)';

/*
submission_history JSONB structure:
[
  {
    "snapshot_at": "2026-01-16T10:30:00Z",
    "submission_number": 1,
    "photo_count": 8,
    "photos_metadata": [...],
    "vlm_categorization_status": "categorized",
    "vlm_categorization_results": [...],
    "feedback_sent": true,
    "feedback_sent_at": "2026-01-16T11:00:00Z",
    "step_completion": {
      "step_01_house_photo": true,
      "step_02_cable_from_pole": false,
      ...
    }
  }
]
*/

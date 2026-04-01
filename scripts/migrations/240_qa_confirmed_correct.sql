-- Migration 240: QA Confirmed Correct Examples
-- Stores photos from DRs where the human operator accepted AI QA without changes.
-- These serve as positive few-shot examples for VLM categorization.

CREATE TABLE IF NOT EXISTS qa_confirmed_correct (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type VARCHAR(50) NOT NULL,
  drop_number TEXT NOT NULL,
  photo_filename TEXT NOT NULL,
  photo_description TEXT,
  vlm_predicted_step INTEGER NOT NULL,
  vlm_predicted_category TEXT NOT NULL,
  vlm_confidence DECIMAL(3,2) NOT NULL,
  vlm_reasoning TEXT,
  confirmed_by TEXT NOT NULL,
  is_canonical BOOLEAN DEFAULT false,
  reviewed_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_confirmed_correct_photo UNIQUE (workflow_type, photo_filename, drop_number)
);

COMMENT ON TABLE qa_confirmed_correct IS 'Positive examples: photos where AI QA was accepted without changes';
COMMENT ON COLUMN qa_confirmed_correct.reviewed_count IS 'Incremented if the same DR is re-confirmed';

CREATE INDEX IF NOT EXISTS idx_confirmed_correct_workflow
  ON qa_confirmed_correct (workflow_type);

CREATE INDEX IF NOT EXISTS idx_confirmed_correct_step
  ON qa_confirmed_correct (vlm_predicted_step);

CREATE INDEX IF NOT EXISTS idx_confirmed_correct_canonical
  ON qa_confirmed_correct (workflow_type) WHERE is_canonical = true;

CREATE INDEX IF NOT EXISTS idx_confirmed_correct_confidence
  ON qa_confirmed_correct (workflow_type, vlm_confidence DESC);

-- Reuse the existing trigger function from migration 084
CREATE TRIGGER trg_confirmed_correct_updated
  BEFORE UPDATE ON qa_confirmed_correct
  FOR EACH ROW
  EXECUTE FUNCTION update_correction_timestamp();

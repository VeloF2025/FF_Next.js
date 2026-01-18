-- Migration 084: QA Correction Examples for Few-Shot Learning
-- Purpose: Store human corrections to VLM categorization for few-shot prompt injection
-- Supports: dr_photo (current), civil_works, optical_works (future)

-- ============================================================================
-- TABLE: qa_correction_examples
-- Stores human overrides to VLM predictions for few-shot learning
-- ============================================================================

CREATE TABLE IF NOT EXISTS qa_correction_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Workflow identification
  workflow_type VARCHAR(50) NOT NULL,     -- 'dr_photo', 'civil_works', 'optical_works'

  -- Photo context
  photo_filename TEXT NOT NULL,
  photo_description TEXT,                  -- VLM's vlm_identified_as field

  -- VLM prediction (what was wrong)
  vlm_predicted_step INTEGER NOT NULL,
  vlm_predicted_category TEXT NOT NULL,
  vlm_confidence DECIMAL(3,2) NOT NULL,
  vlm_reasoning TEXT,

  -- Human correction (ground truth)
  correct_step INTEGER NOT NULL,
  correct_category TEXT NOT NULL,
  correction_reason TEXT,                  -- Why VLM was wrong (optional)

  -- Quality signals for example selection
  corrected_by TEXT NOT NULL,              -- User who made the correction
  reviewed_count INTEGER DEFAULT 1,        -- Multiple reviewers agreed? (for weighting)
  is_canonical BOOLEAN DEFAULT false,      -- Manually curated as high-quality example

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- INDEXES for efficient few-shot example retrieval
-- ============================================================================

-- Primary lookup by workflow type
CREATE INDEX IF NOT EXISTS idx_corrections_workflow
  ON qa_correction_examples(workflow_type);

-- Find corrections where VLM predicted a specific step
CREATE INDEX IF NOT EXISTS idx_corrections_vlm_step
  ON qa_correction_examples(vlm_predicted_step);

-- Find corrections for a specific correct step
CREATE INDEX IF NOT EXISTS idx_corrections_correct_step
  ON qa_correction_examples(correct_step);

-- Quick access to canonical (curated) examples
CREATE INDEX IF NOT EXISTS idx_corrections_canonical
  ON qa_correction_examples(is_canonical) WHERE is_canonical = true;

-- Composite index for common query pattern: workflow + high confidence mistakes
CREATE INDEX IF NOT EXISTS idx_corrections_workflow_confidence
  ON qa_correction_examples(workflow_type, vlm_confidence DESC);

-- ============================================================================
-- TABLE: qa_workflow_steps
-- Stores step definitions per workflow (for multi-workflow support)
-- ============================================================================

CREATE TABLE IF NOT EXISTS qa_workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type VARCHAR(50) NOT NULL,
  step_number INTEGER NOT NULL,
  step_label VARCHAR(100) NOT NULL,
  step_description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(workflow_type, step_number)
);

-- ============================================================================
-- SEED DATA: DR Photo steps (10-step checklist)
-- Source: src/modules/activate/utils/stepMapper.ts
-- ============================================================================

INSERT INTO qa_workflow_steps (workflow_type, step_number, step_label, step_description) VALUES
  ('dr_photo', 1, 'House Photo', 'Photo of the house/property for location verification'),
  ('dr_photo', 2, 'Cable from Pole', 'Aerial fiber drop from utility pole to house'),
  ('dr_photo', 3, 'Entry Outside', 'EXTERIOR view of where cable enters building'),
  ('dr_photo', 4, 'Entry Inside', 'INTERIOR view of cable routing from entry point toward ONT'),
  ('dr_photo', 5, 'Wall', 'Wall surface with mounting bracket and power outlet before ONT install'),
  ('dr_photo', 6, 'ONT Back', 'Back panel of ONT showing fiber and power cable connections'),
  ('dr_photo', 7, 'Power Meter', 'Optical power meter display showing dBm reading'),
  ('dr_photo', 8, 'Final Installation', 'Wide shot of complete setup (ONT mounted, UPS/GIZZU connected)'),
  ('dr_photo', 9, 'Green Lights', 'Front panel of ONT with illuminated indicator lights'),
  ('dr_photo', 10, 'Signature', 'Customer signature on completion form')
ON CONFLICT (workflow_type, step_number) DO UPDATE SET
  step_label = EXCLUDED.step_label,
  step_description = EXCLUDED.step_description;

-- ============================================================================
-- TRIGGER: Update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_correction_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_correction_updated_at ON qa_correction_examples;
CREATE TRIGGER trigger_correction_updated_at
  BEFORE UPDATE ON qa_correction_examples
  FOR EACH ROW
  EXECUTE FUNCTION update_correction_timestamp();

-- ============================================================================
-- COMMENTS for documentation
-- ============================================================================

COMMENT ON TABLE qa_correction_examples IS
  'Stores human corrections to VLM photo categorizations for few-shot learning. Corrections are workflow-isolated.';

COMMENT ON TABLE qa_workflow_steps IS
  'Defines step categories per workflow type. DR Photos have 10 steps, Civil/Optical will have their own.';

COMMENT ON COLUMN qa_correction_examples.is_canonical IS
  'Manually marked by curator as high-quality example. Canonical examples are prioritized in few-shot selection.';

COMMENT ON COLUMN qa_correction_examples.reviewed_count IS
  'Number of reviewers who agreed with this correction. Higher = more reliable example.';

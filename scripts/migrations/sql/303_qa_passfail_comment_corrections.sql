-- Migration 303: Pass/Fail + Comment Correction Learning Tables
-- Purpose: Extend HITL learning beyond step categorization.
-- Captures human overrides of VLM Pass/Fail decisions and auto-generated
-- comments so future auto-QA runs can be guided by prior human judgments.
--
-- Mirrors 084_qa_correction_examples.sql pattern:
--   - workflow_type isolates learning per QA surface
--   - vlm_* columns store the original AI prediction
--   - correct_* columns store the human ground-truth
--   - is_canonical / reviewed_count are quality signals for few-shot selection

-- ============================================================================
-- TABLE: qa_passfail_corrections
-- Records when a human flipped VLM's PASS/FAIL decision.
-- ============================================================================

CREATE TABLE IF NOT EXISTS qa_passfail_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workflow_type VARCHAR(50) NOT NULL,       -- 'dr_photo', 'civil_works', etc.
  drop_number TEXT,                         -- DR context (nullable for non-DR workflows)

  photo_filename TEXT NOT NULL,
  photo_description TEXT,                   -- VLM's vlm_identified_as
  step INTEGER NOT NULL,                    -- Step at time of correction
  step_label TEXT,

  -- VLM original decision
  vlm_decision VARCHAR(8) NOT NULL,         -- 'PASS' | 'FAIL'
  vlm_confidence DECIMAL(3,2) NOT NULL,
  vlm_reasoning TEXT,
  vlm_comment TEXT,                         -- Auto-generated comment at decision time

  -- Human-corrected decision
  correct_decision VARCHAR(8) NOT NULL,     -- 'PASS' | 'FAIL'
  correction_reason TEXT,

  -- Quality signals
  corrected_by TEXT NOT NULL,
  reviewed_count INTEGER DEFAULT 1,
  is_canonical BOOLEAN DEFAULT false,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT qa_passfail_decision_differs CHECK (vlm_decision <> correct_decision),
  CONSTRAINT qa_passfail_vlm_decision_valid CHECK (vlm_decision IN ('PASS','FAIL')),
  CONSTRAINT qa_passfail_correct_decision_valid CHECK (correct_decision IN ('PASS','FAIL'))
);

CREATE INDEX IF NOT EXISTS idx_passfail_workflow
  ON qa_passfail_corrections(workflow_type);
CREATE INDEX IF NOT EXISTS idx_passfail_step
  ON qa_passfail_corrections(workflow_type, step);
CREATE INDEX IF NOT EXISTS idx_passfail_canonical
  ON qa_passfail_corrections(is_canonical) WHERE is_canonical = true;
CREATE INDEX IF NOT EXISTS idx_passfail_drop
  ON qa_passfail_corrections(drop_number);

-- ============================================================================
-- TABLE: qa_comment_corrections
-- Records when a human rewrote VLM's auto-generated comment.
-- ============================================================================

CREATE TABLE IF NOT EXISTS qa_comment_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workflow_type VARCHAR(50) NOT NULL,
  drop_number TEXT,

  photo_filename TEXT NOT NULL,
  photo_description TEXT,
  step INTEGER NOT NULL,
  step_label TEXT,
  decision VARCHAR(8) NOT NULL,             -- Decision at time comment was written
  vlm_confidence DECIMAL(3,2),
  vlm_reasoning TEXT,

  -- The auto-generated comment (what VLM produced)
  vlm_comment TEXT NOT NULL,

  -- The human-rewritten comment (ground truth tone/content)
  corrected_comment TEXT NOT NULL,

  -- Quality signals
  corrected_by TEXT NOT NULL,
  reviewed_count INTEGER DEFAULT 1,
  is_canonical BOOLEAN DEFAULT false,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT qa_comment_decision_valid CHECK (decision IN ('PASS','FAIL')),
  CONSTRAINT qa_comment_text_differs CHECK (TRIM(vlm_comment) <> TRIM(corrected_comment))
);

CREATE INDEX IF NOT EXISTS idx_comment_corr_workflow
  ON qa_comment_corrections(workflow_type);
CREATE INDEX IF NOT EXISTS idx_comment_corr_step
  ON qa_comment_corrections(workflow_type, step);
CREATE INDEX IF NOT EXISTS idx_comment_corr_decision
  ON qa_comment_corrections(workflow_type, decision);
CREATE INDEX IF NOT EXISTS idx_comment_corr_canonical
  ON qa_comment_corrections(is_canonical) WHERE is_canonical = true;
CREATE INDEX IF NOT EXISTS idx_comment_corr_drop
  ON qa_comment_corrections(drop_number);

-- ============================================================================
-- updated_at triggers
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_passfail_updated_at ON qa_passfail_corrections;
CREATE TRIGGER trigger_passfail_updated_at
  BEFORE UPDATE ON qa_passfail_corrections
  FOR EACH ROW
  EXECUTE FUNCTION update_correction_timestamp();

DROP TRIGGER IF EXISTS trigger_comment_corr_updated_at ON qa_comment_corrections;
CREATE TRIGGER trigger_comment_corr_updated_at
  BEFORE UPDATE ON qa_comment_corrections
  FOR EACH ROW
  EXECUTE FUNCTION update_correction_timestamp();

-- ============================================================================
-- Documentation
-- ============================================================================

COMMENT ON TABLE qa_passfail_corrections IS
  'Human overrides of VLM PASS/FAIL decisions. Used as few-shot examples to guide future auto-QA pass/fail calls.';

COMMENT ON TABLE qa_comment_corrections IS
  'Human rewrites of VLM-generated photo comments. Used as few-shot examples to guide future auto-generated comment tone and specificity.';

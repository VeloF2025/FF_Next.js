-- Migration 317: Add promoted_at column and index for canonical auto-promotion
-- (renamed from 274_ — collision with 274_ticket_subtypes.sql)
-- Purpose: Support auto-promoting high-frequency corrections to canonical status

-- Add promoted_at timestamp to track when corrections were auto-promoted
ALTER TABLE qa_correction_examples
  ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ DEFAULT NULL;

-- Add composite index for canonical lookup performance
CREATE INDEX IF NOT EXISTS idx_qa_corrections_canonical_lookup
  ON qa_correction_examples (vlm_predicted_step, correct_step, is_canonical)
  WHERE workflow_type = 'dr_photo';

-- Add index for frequency analysis queries
CREATE INDEX IF NOT EXISTS idx_qa_corrections_step_pairs
  ON qa_correction_examples (workflow_type, vlm_predicted_step, correct_step);

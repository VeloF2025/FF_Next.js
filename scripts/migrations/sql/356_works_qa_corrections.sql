-- Migration 356: works_qa_corrections
--
-- Captures human overrides of VLM verdicts on works-qa photo slots, so the
-- next VLM training run can learn from the disagreement.
--
-- Distinct from qa_correction_examples (migration 084) — that table is
-- designed for DR-photo step-mapping (1..10), not per-slot pass/fail verdicts.
-- We keep them separate so the schemas don't drift into compromise.
--
-- Sources P1 of the Civil QA snag UX overhaul (spec 2026-05-19).

CREATE TABLE IF NOT EXISTS works_qa_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link back to the photo + slot under review
  pole_qa_photo_id UUID NOT NULL REFERENCES pole_qa_photos(id) ON DELETE CASCADE,
  slot_key TEXT NOT NULL,

  -- VLM verdict at the time of the human override
  vlm_verdict TEXT NOT NULL CHECK (vlm_verdict IN ('pass', 'fail', 'overridden')),
  vlm_confidence DECIMAL(3,2),
  vlm_feedback TEXT,

  -- Human verdict (the override)
  human_verdict TEXT NOT NULL CHECK (human_verdict IN ('snagged', 'approved')),
  correction_notes TEXT NOT NULL,

  -- Audit trail
  snag_id UUID REFERENCES snags(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup by slot for training-data assembly
CREATE INDEX IF NOT EXISTS idx_works_qa_corrections_slot
  ON works_qa_corrections (slot_key, human_verdict);

-- Lookup by photo for backfill / repair queries
CREATE INDEX IF NOT EXISTS idx_works_qa_corrections_photo
  ON works_qa_corrections (pole_qa_photo_id);

-- Lookup by snag for audit-trail joins from the snag detail view
CREATE INDEX IF NOT EXISTS idx_works_qa_corrections_snag
  ON works_qa_corrections (snag_id);

-- Migration 166: VLM Visual Photo Examples
-- Stores gallery-curated good/bad photo URLs as visual few-shot examples
-- for stepQualityValidationService (auto-QA and PWA).

CREATE TABLE IF NOT EXISTS vlm_visual_photo_examples (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_number INTEGER NOT NULL CHECK (step_number BETWEEN 1 AND 12),
  photo_url   TEXT NOT NULL,
  label       TEXT NOT NULL CHECK (label IN ('positive', 'negative')),
  dr_number   TEXT,
  filename    TEXT,
  confidence  NUMERIC(4,3),
  saved_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(photo_url)
);

CREATE INDEX idx_vlm_visual_examples_step
  ON vlm_visual_photo_examples (step_number, label);

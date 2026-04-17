-- 308_verification_step_ai_narrative.sql
--
-- AI-generated multi-photo step narrative. Per-photo captions (column
-- maintenance_attachments.ai_caption) describe individual shots; this column
-- holds a short 2-3 sentence summary of what was done across the whole step,
-- produced by a single VLM call that sees every photo from that step in
-- sequence. Cached so regenerating the report is instant after the first run.
--
-- Additive, idempotent.

BEGIN;

ALTER TABLE maintenance_verification_steps
  ADD COLUMN IF NOT EXISTS ai_narrative TEXT,
  ADD COLUMN IF NOT EXISTS ai_narrative_generated_at TIMESTAMPTZ;

COMMIT;

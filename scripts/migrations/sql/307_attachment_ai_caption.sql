-- 307_attachment_ai_caption.sql
--
-- AI-generated descriptions for attachment photos, used by the NOC ticket
-- report PDF (#1345). Captions come from the VLM with prompts that differ
-- based on whether the photo is "before" evidence (describe the issue) or
-- "after" evidence (describe what was fixed). Cached on the attachment row
-- so regenerating the report is near-instant after the first run.
--
-- Additive, idempotent. Safe to re-apply.

BEGIN;

ALTER TABLE maintenance_attachments
  ADD COLUMN IF NOT EXISTS ai_caption TEXT,
  ADD COLUMN IF NOT EXISTS ai_caption_context VARCHAR(20), -- 'before' | 'after' | 'general'
  ADD COLUMN IF NOT EXISTS ai_caption_confidence VARCHAR(10),
  ADD COLUMN IF NOT EXISTS ai_caption_generated_at TIMESTAMPTZ;

COMMIT;

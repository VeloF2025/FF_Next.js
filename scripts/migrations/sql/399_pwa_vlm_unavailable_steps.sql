-- Migration 399: record SiteCam steps that auto-passed while the VLM was down
-- Purpose: when the VLM is unreachable the capture wizard "fails open" (never
--          blocks the technician). Those photos are uploaded but must be flagged
--          for manual QA review rather than treated as verified passes.
-- Stores a JSON array of step numbers per submission. Safe to re-run.

ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN IF NOT EXISTS pwa_vlm_unavailable_steps JSONB;

ALTER TABLE pole_install_sessions
  ADD COLUMN IF NOT EXISTS pwa_vlm_unavailable_steps JSONB;

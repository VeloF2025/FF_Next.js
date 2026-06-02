-- Rollback for migration 399: drop the VLM-unavailable manual-review columns.

ALTER TABLE dr_photo_unified_reviews
  DROP COLUMN IF EXISTS pwa_vlm_unavailable_steps;

ALTER TABLE pole_install_sessions
  DROP COLUMN IF EXISTS pwa_vlm_unavailable_steps;

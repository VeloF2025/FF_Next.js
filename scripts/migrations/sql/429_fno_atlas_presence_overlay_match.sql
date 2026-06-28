-- Migration 429: allow FNO Atlas presence-point overlay matches
-- Purpose: nearest township/presence-marker matches are evidence, but not polygon coverage.

ALTER TABLE fno_atlas_project_overlays
  DROP CONSTRAINT IF EXISTS fno_atlas_project_overlay_match_check;

ALTER TABLE fno_atlas_project_overlays
  ADD CONSTRAINT fno_atlas_project_overlay_match_check
  CHECK (match_type IN (
    'inside_coverage',
    'near_coverage',
    'near_presence_point',
    'backhaul_nearby',
    'no_match'
  ));

INSERT INTO schema_migrations (filename, applied_at)
VALUES ('429_fno_atlas_presence_overlay_match.sql', NOW())
ON CONFLICT (filename) DO NOTHING;

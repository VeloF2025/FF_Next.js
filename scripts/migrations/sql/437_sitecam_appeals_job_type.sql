-- scripts/migrations/sql/437_sitecam_appeals_job_type.sql
-- Auto-Appeals VLM, Phase 2. Captures the SiteCam discipline (activations|civils)
-- on each appeal so the scoring cron can select the correct step criteria and
-- gallery. Nullable: legacy rows predate capture and are treated as 'activations'
-- by the cron. See docs/superpowers/specs/2026-07-01-sitecam-appeals-vlm-design.md §5.3.
ALTER TABLE sitecam_appeals
  ADD COLUMN IF NOT EXISTS job_type text
      CHECK (job_type IN ('activations','civils'));

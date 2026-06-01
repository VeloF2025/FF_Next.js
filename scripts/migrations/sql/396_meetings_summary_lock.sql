-- Migration 396: meetings summary lock — Cortex Scribe Goal 3b (summary write-back)
--
-- When a reviewer edits + publishes a meeting summary in the Cortex Scribe reviewer
-- panel, the human-edited summary is written back into meetings.summary (by the
-- pull-cortex-meeting-actions cron). These two columns mark that the summary is now
-- a human-reviewed override so FibreFlow's own LLM/transcript pipeline does NOT
-- regenerate over it. Lock rule = "human wins & sticks": only another human re-review
-- (re-open → edit → re-publish) updates the summary again.
--
--   summary_source    — provenance of meetings.summary. 'cortex_human_reviewed' is the
--                       lock value checked by writeSummary() before any regeneration.
--                       NULL = AI/transcript-generated (the default, unlocked).
--   summary_locked_at — wall-clock time the human override was written (audit only).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. No backfill — existing rows stay unlocked.

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS summary_source    TEXT;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS summary_locked_at TIMESTAMPTZ;

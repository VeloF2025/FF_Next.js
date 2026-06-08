-- Migration 403: Works QA — per-user "since I last opened" watermark
-- Purpose: back the Recent Submissions feed's "since I last opened" window.
--   One row per user (keyed by email, matching pole_qa_photos.approved_by).
--   cutoff_at      — the boundary the feed shows "new since" against.
--   last_active_at — heartbeat; lets the read roll cutoff forward only when a
--                    genuinely new viewing session starts (>30 min gap), so a
--                    page refresh within a session doesn't blank the feed.
-- All idempotent; safe to re-run.

CREATE TABLE IF NOT EXISTS works_qa_view_watermark (
  user_email      TEXT PRIMARY KEY,
  cutoff_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The Recent feed joins pole_qa_photos slot-key columns back to
-- qfield_photo_validations on photo_key to recover per-discipline submission
-- times. Index the join key so the rollup stays fast as volumes grow.
CREATE INDEX IF NOT EXISTS idx_qpv_photo_key
  ON qfield_photo_validations (photo_key);

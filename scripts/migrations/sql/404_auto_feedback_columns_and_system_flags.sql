-- Migration 404: auto-feedback cron — tracking columns + system_flags kill switch
-- Purpose: the auto-feedback cron (/api/cron/auto-feedback) sends private WA
--          feedback to technicians 30+ min after auto-QA. It needs:
--            * dr_photo_unified_reviews.auto_feedback_sent_at    — when auto-send fired (NULL = not sent)
--            * dr_photo_unified_reviews.auto_feedback_skip_reason — why auto-send was skipped (NULL = no skip)
--            * dr_photo_unified_reviews.auto_feedback_attempts    — failed WA-send attempts, for the retry cap
--            * system_flags                                       — runtime kill switch (auto_feedback_enabled)
-- These objects were provisioned out-of-band on the shared DB; this migration
-- records them in schema_migrations and reproduces them on fresh environments.
-- Fully idempotent — safe to re-run.

ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN IF NOT EXISTS auto_feedback_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_feedback_skip_reason TEXT,
  ADD COLUMN IF NOT EXISTS auto_feedback_attempts    INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS system_flags (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO system_flags (key, value)
VALUES ('auto_feedback_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

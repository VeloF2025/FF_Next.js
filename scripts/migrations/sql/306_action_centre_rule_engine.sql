-- 306_action_centre_rule_engine.sql
--
-- RFC Phase 3: Action Centre rule engine checkpoint + run audit.
-- The cron-driven engine in pages/api/cron/action-centre-rules.ts reads
-- dr_activity_log events since its last checkpoint and applies rules.
-- Each rule tracks its own watermark so they run independently.
--
-- Additive, idempotent.

BEGIN;

-- Per-rule watermark so the engine is idempotent across restarts.
-- Rule code: 'pre_prov_activated_close_tickets', 'serial_reconciled_close_tickets',
-- 'n4_after_fix_dispute_candidate' (initial set).
CREATE TABLE IF NOT EXISTS action_centre_rule_checkpoints (
  rule_name         TEXT PRIMARY KEY,
  last_event_id     UUID,
  last_event_at     TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-run audit: one row per cron invocation, tracks events processed
-- and actions taken. Useful for dashboard + post-mortem debugging.
CREATE TABLE IF NOT EXISTS action_centre_rule_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  dry_run           BOOLEAN     NOT NULL DEFAULT FALSE,
  events_processed  INT         NOT NULL DEFAULT 0,
  actions_taken     INT         NOT NULL DEFAULT 0,
  rules_summary     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  errors            JSONB       NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_rule_runs_started
  ON action_centre_rule_runs(started_at DESC);

-- Lookup index for finding recent serial_reconciled events per DR — used by
-- rule n4_after_fix_dispute_candidate to decide if a new N4 flag counts as
-- a dispute candidate.
CREATE INDEX IF NOT EXISTS idx_dr_activity_reconciled
  ON dr_activity_log(drop_number, created_at DESC)
  WHERE event_type = 'serial_reconciled';

COMMIT;

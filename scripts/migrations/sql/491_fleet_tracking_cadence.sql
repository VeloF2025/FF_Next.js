-- 491: per-account poll cadence and gap-alert bookkeeping for fleet tracking.
--
-- The portal poll cadence lived only in a crontab (`0 */2 * * *`), which made
-- it impossible to ramp one partner without ramping all of them, and invisible
-- to the code that has to reason about it. staleness.ts hardcoded a matching
-- 3-hour threshold under the stated assumption "the cadence is set by cron" —
-- the two were coupled by comment, not by data.
--
-- DEFAULT 120 reproduces today's behaviour exactly, so this migration is inert
-- until a row is deliberately updated. That matters: this database is shared by
-- dev and production, so a migration that changed behaviour on apply would
-- change it for production the moment dev deployed.
--
-- last_gap_alert_at exists because the gap re-alert interval was counted in
-- TICKS (GAP_REPEAT_TICKS = 12, "roughly one reminder a day" at 2-hourly). Tick
-- counting silently tightens as the cadence tightens; at 10 minutes the same
-- constant means one reminder every two hours. Wall-clock needs a timestamp to
-- measure from, and there was nowhere to put one.

ALTER TABLE fleet_tracking_watermarks
  ADD COLUMN IF NOT EXISTS poll_interval_minutes INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS last_gap_alert_at TIMESTAMPTZ NULL;

ALTER TABLE fleet_tracking_watermarks
  ADD CONSTRAINT fleet_tracking_watermarks_poll_interval_check
  CHECK (poll_interval_minutes BETWEEN 1 AND 1440);

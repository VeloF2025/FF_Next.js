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
--
-- evicted_since exists for the same reason, one layer down. Netstar allows a
-- single session, so a human opening the portal throws our poller out; that
-- self-heals when they leave and must not page anyone. But a dead credential
-- presents identically, so eviction has to escalate once it is SUSTAINED —
-- which requires knowing when the eviction streak began. The only other source
-- would be `consecutive_failures * poll_interval_minutes`, which reintroduces
-- exactly the tick-coupling last_gap_alert_at was added to remove. Set when an
-- eviction streak starts; cleared on a healthy tick or a different failure kind.

ALTER TABLE fleet_tracking_watermarks
  ADD COLUMN IF NOT EXISTS poll_interval_minutes INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS last_gap_alert_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS evicted_since TIMESTAMPTZ NULL;

ALTER TABLE fleet_tracking_watermarks
  ADD CONSTRAINT fleet_tracking_watermarks_poll_interval_check
  CHECK (poll_interval_minutes BETWEEN 1 AND 1440);

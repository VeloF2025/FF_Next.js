-- Rollback 491.
ALTER TABLE fleet_tracking_watermarks
  DROP CONSTRAINT IF EXISTS fleet_tracking_watermarks_poll_interval_check;

ALTER TABLE fleet_tracking_watermarks
  DROP COLUMN IF EXISTS poll_interval_minutes,
  DROP COLUMN IF EXISTS last_gap_alert_at;

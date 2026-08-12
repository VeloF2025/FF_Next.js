-- 492: per-vehicle re-alert cooldown for tracker silence detection.
--
-- Task 8 (silence.ts) originally reused fleet_tracking_watermarks.last_gap_alert_at
-- for this — the same (provider, account_ref) row the account-wide gap detector
-- stamps. Review caught the defect: that key is per ACCOUNT, not per vehicle, so
-- a second vehicle going silent on the same account within 24h of the first got
-- no alert of its own, only a log.warn. With 3-7 vehicles per account that is a
-- plausible daily occurrence, not an edge case.
--
-- The reviewer's first fix — a synthetic account_ref of
-- `${accountRef}:silence:${vehicleId}` — does not work: account_ref is
-- VARCHAR(50) and `europcar:silence:<uuid>` is 53 characters, so it throws
-- "value too long" at runtime the first time it fires.
--
-- Widening fleet_tracking_watermarks itself was also rejected: that table is
-- read by every operational query anyone runs against real provider/account
-- pairs (dashboards, the ramp-up rollout steps in the design doc, ad-hoc
-- audits). Synthetic per-vehicle rows in it would look like real accounts to
-- anyone who didn't know to filter them out.
--
-- So this is a dedicated table, one row per vehicle, keyed on vehicle_id
-- directly. No DEFAULT trick makes this migration inert the way 491's did —
-- there is no prior row for last_alert_at to default to, and the detector is
-- inert until Task 8's cron wiring runs anyway. CASCADE on vehicle_id: a
-- deleted vehicle has nothing left to cool down for.

CREATE TABLE IF NOT EXISTS fleet_tracker_silence_alerts (
  vehicle_id     UUID PRIMARY KEY REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  last_alert_at  TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

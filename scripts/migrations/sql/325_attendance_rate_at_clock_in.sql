-- Migration 325: staff_rate_at_clock_in — point-in-time rate snapshot
--
-- Captures staff.hourly_rate at the moment the staff clocks in, keyed
-- by attendance_entries.id. Solves the follow-up from PR #1406:
-- without this, a rate change between clock-in and reconcile applies
-- the newer rate to the already-worked shift (documented in the wage
-- calculator as an accepted quirk, but wrong for month-end bumps).
--
-- Contract:
--   - One row per attendance_entries row, max. PRIMARY KEY enforces it.
--   - hourly_rate_cents is an integer — same unit as
--     attendance_daily_summaries.hourly_rate_snapshot_cents (#324).
--     Zero-valued rates are LEGAL (a genuinely R0 rate is rare but
--     real — e.g. unpaid training shift). NULL rates would mean "we
--     don't know" which is NOT what we want here; the write path
--     skips the INSERT entirely if staff.hourly_rate IS NULL, leaving
--     the reconcile cron to fall back to its existing behaviour
--     (read current staff.hourly_rate at compute time).
--   - ON DELETE CASCADE from attendance_entries: if an entry is ever
--     deleted (today: never, by design) the snapshot goes with it.
--
-- Reconcile wire-up (same PR):
--   reconcileQueries.loadClosedEntriesMissingSummary LEFT JOINs this
--   table and prefers the snapshot over staff.hourly_rate when
--   present. Entries from before this migration existed have no
--   snapshot → fall back to today's rate (same as current behaviour,
--   no regression).
--
-- Growth: ~100 clock-ins/day × 365 days = ~36k rows/year. Negligible
-- at this fleet size; no partitioning / pruning needed for years.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS staff_rate_at_clock_in (
    entry_id UUID PRIMARY KEY REFERENCES attendance_entries(id) ON DELETE CASCADE,
    hourly_rate_cents BIGINT NOT NULL CHECK (hourly_rate_cents >= 0),
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE staff_rate_at_clock_in IS
  'Point-in-time hourly rate (cents) captured when staff clocks in. '
  'Reconcile reads this in preference to staff.hourly_rate so a '
  'mid-period rate change does not retroactively reprice completed '
  'shifts. Entries pre-dating this table fall back to staff.hourly_rate.';

COMMENT ON COLUMN staff_rate_at_clock_in.hourly_rate_cents IS
  'Cents-per-hour. Zero is a legal value (e.g. unpaid training); '
  'NULL is NOT allowed — skip the INSERT when staff.hourly_rate is unset.';

-- ---------------------------------------------------------------------------
-- GRANTs — app runs as fibreflow_user (migration 310 pattern).
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES
  ON staff_rate_at_clock_in TO fibreflow_user;

-- ---------------------------------------------------------------------------
-- Verify (uncomment after apply)
-- ---------------------------------------------------------------------------
-- \d+ staff_rate_at_clock_in
-- SELECT COUNT(*) FROM staff_rate_at_clock_in;
-- -- Round-trip:
-- SAVEPOINT s1;
-- INSERT INTO staff_rate_at_clock_in (entry_id, hourly_rate_cents)
-- VALUES ((SELECT id FROM attendance_entries LIMIT 1), 12000);
-- ROLLBACK TO s1;

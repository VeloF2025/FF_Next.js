-- Migration 324: attendance_daily_summaries.hourly_rate_snapshot_cents
--
-- Audit column capturing the hourly rate that produced wage_amount_cents
-- at the moment the reconcile cron wrote the summary. Without the
-- snapshot, any later change to staff.hourly_rate makes the persisted
-- wage_amount_cents unreconstructable ("why is Jan's Monday R12.50 less
-- than Feb's?").
--
-- Rate-at-time-of-clock is the policy we approximate here: read
-- staff.hourly_rate at reconcile time (shortly after shift ends) and
-- snapshot it alongside the computed wage. A true rate-at-clock-in
-- would need a historical rate table (staff_rate_history) — deferred.
-- If staff.hourly_rate changes between clock-in and reconcile (monthly
-- promotions), the newer rate applies. Practically fine; documented in
-- the calculator's header.
--
-- BCEA s6 threshold: bcea_applicable=false staff get wage_amount_cents
-- computed on regularHrs only (no OT / Sunday / holiday stacking). The
-- snapshot still records the rate so a reviewer can reconstruct.
--
-- NULL semantics:
--   - NULL when staff.hourly_rate was NULL at reconcile time (e.g.
--     salaried staff not yet converted to hourly). wage_amount_cents
--     is also NULL in this case.
--   - Non-NULL when a computation happened; always consistent with
--     wage_amount_cents also being non-NULL via the CHECK below.
--
-- Idempotent: safe to re-run.

ALTER TABLE attendance_daily_summaries
  ADD COLUMN IF NOT EXISTS hourly_rate_snapshot_cents BIGINT
    CHECK (hourly_rate_snapshot_cents IS NULL OR hourly_rate_snapshot_cents >= 0);

-- Paired invariant: if we stored a wage, we stored the rate that produced
-- it; and vice versa. Prevents a half-populated row slipping past
-- auditors. Named so DROP CONSTRAINT is idempotent.
ALTER TABLE attendance_daily_summaries
  DROP CONSTRAINT IF EXISTS attendance_daily_summaries_wage_and_rate_together;

ALTER TABLE attendance_daily_summaries
  ADD CONSTRAINT attendance_daily_summaries_wage_and_rate_together
  CHECK (
    (wage_amount_cents IS NULL AND hourly_rate_snapshot_cents IS NULL)
    OR
    (wage_amount_cents IS NOT NULL AND hourly_rate_snapshot_cents IS NOT NULL)
  );

COMMENT ON COLUMN attendance_daily_summaries.hourly_rate_snapshot_cents IS
  'Rate (in cents per hour) read from staff.hourly_rate at reconcile time '
  'and used to compute wage_amount_cents. NULL when staff has no rate set; '
  'paired-nullable with wage_amount_cents via the CHECK constraint.';

-- ---------------------------------------------------------------------------
-- Verify (uncomment to run after applying)
-- ---------------------------------------------------------------------------
-- \d+ attendance_daily_summaries
-- -- Should fail:
-- SAVEPOINT s1;
-- INSERT INTO attendance_daily_summaries (staff_id, work_date, rule_id, wage_amount_cents)
-- VALUES (gen_random_uuid(), '2026-04-20', (SELECT id FROM attendance_overtime_rules LIMIT 1), 10000);
-- ROLLBACK TO s1;

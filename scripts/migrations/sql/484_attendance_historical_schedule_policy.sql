-- Migration 484: cover the pre-cutover attendance era with an explicit schedule policy.
--
-- Why: attendance_schedule_policies held exactly one row, active_from 2026-08-03,
-- seeded by migration 475. Every path that projects an attendance day filters on
-- policy coverage — loadEffectivePolicy() throws for an uncovered date, and both
-- loadReconciliationEntries() and loadOpenEntriesForReconciliation() carry an
-- EXISTS(...) over this table — so no work date before 2026-08-03 could be
-- projected at all. Attendance data starts 2026-04-24.
--
-- Two consequences were observed in production:
--   * 11 worker corrections approved on 2026-08-06 changed nobody's hours,
--     because the reconciler cannot project the days they belong to.
--   * Every payroll week before 2026-08-03 is permanently unlockable, and the
--     targeted reconcile that would repair it fails with "No attendance schedule
--     policy covers ..." — see issue #2382. That failed run is on record in
--     attendance_reconciliation_runs (2026-06-23, status 'failed').
--
-- This row does NOT re-price history. replaceProjection() and the projection
-- INSERT (src/services/attendance/policy/projectionStatements.ts) write only the
-- policy-era columns: schedule_policy_id, scheduled_paid_hrs, recorded_elapsed_hrs,
-- proposed_*, leave_hrs, unpaid_hrs, attendance_classification, result_status,
-- blocking_reasons, calculation_fingerprint, approved_*, result_version. They
-- never write regular_hrs, overtime_hrs, sunday_hrs, holiday_hrs, night_hrs or
-- wage_amount_cents.
--
-- Verified against production before writing: 1,272 of the 1,882 pre-cutover
-- summaries carry non-zero regular/overtime — 12,354.24 hours in total — and none
-- of it is reachable by the projection, while leave_hrs, unpaid_hrs and
-- attendance_classification are 0 / 0 / NULL on all 1,882 rows. So there is
-- nothing for a re-projection to overwrite. Only 7 pre-cutover staff-days have an
-- entry but no summary; those take the INSERT path and are new rows, not edits.
--
-- The row is inert on its own. The nightly reconcile scans a trailing 14 days
-- (DEFAULT_WINDOW_DAYS, src/services/attendance/reconcile.ts), so adding coverage
-- retro-projects nothing by itself. A targeted --from/--to run is required — which
-- is precisely what this migration makes possible.
--
-- Boundaries: active_from is 2026-04-24, the earliest attendance_entries.work_date.
-- active_to is derived as (earliest existing active_from - 1) rather than hardcoded,
-- so the new row is contiguous with the existing one by construction and cannot
-- overlap it no matter what the existing boundary happens to be. Overlap matters
-- because findEffectivePolicy() resolves ties with ORDER BY active_from DESC LIMIT 1
-- — an overlap would silently pick a winner instead of failing.
--
-- The schedule matches the current policy. That is not a shortcut: the CHECK
-- constraints on this table pin weekday_unpaid_break_minutes = 60,
-- weekday_paid_cap_hrs = 8, saturday_paid_cap_hrs = 5, sunday_scheduled = false and
-- sunday_missing_out_cap_hrs = 5, so those columns cannot differ per era anyway.
-- The start/end times take the table defaults, which equal the current row's values
-- (08:00-17:00 weekday, 08:00-13:00 Saturday). Confirmed with Hein that these hours
-- were in force April-July.
--
-- The unique index attendance_schedule_policies_one_open permits only one
-- open-ended policy. This row sets active_to, so it is not open-ended and does not
-- contend for that index.
--
-- Re-runnable: the INSERT fires only when the era is not already covered.

DO $$
DECLARE
  earliest_active_from  DATE;
  default_rule_count    BIGINT;
  default_rule_id       UUID;
  new_active_to         DATE;
BEGIN
  SELECT MIN(active_from) INTO earliest_active_from FROM attendance_schedule_policies;

  IF earliest_active_from IS NULL THEN
    RAISE EXCEPTION
      'Migration 484 preflight: attendance_schedule_policies is empty, so there is no cutover boundary to sit before.'
      USING HINT =
        'Migration 475 seeds the "Velocity fixed hours" policy. Apply it before this migration.';
  END IF;

  -- Already covered — either this migration ran before, or the boundary was
  -- moved by other means. Either way the goal is met and inserting would
  -- overlap. Idempotent no-op.
  IF earliest_active_from <= DATE '2026-04-24' THEN
    RETURN;
  END IF;

  new_active_to := earliest_active_from - 1;

  -- Same one-default-rule assertion migration 475 makes when it seeds the
  -- current policy. overtime_rule_id is NOT NULL, and picking the wrong rule
  -- would silently re-base overtime for the whole historical era.
  SELECT COUNT(*), (ARRAY_AGG(id ORDER BY id))[1]
    INTO default_rule_count, default_rule_id
    FROM attendance_overtime_rules
   WHERE is_default = true;

  IF default_rule_count <> 1 THEN
    RAISE EXCEPTION 'Migration 484 preflight: expected exactly one default overtime rule, found %',
      default_rule_count;
  END IF;

  INSERT INTO attendance_schedule_policies (name, active_from, active_to, overtime_rule_id)
  VALUES ('Velocity fixed hours (pre-cutover)', DATE '2026-04-24', new_active_to, default_rule_id);
END;
$$;

COMMENT ON TABLE attendance_schedule_policies IS
  'Effective-dated attendance schedules. Rows must not overlap: findEffectivePolicy '
  'resolves with ORDER BY active_from DESC LIMIT 1, so an overlap silently picks a '
  'winner rather than failing. Migration 484 added the pre-2026-08-03 era, whose '
  'absence made every earlier work date unprojectable.';

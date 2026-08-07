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
-- That is not taken on trust — the preflight re-reads MIN(work_date) at run time and
-- refuses to proceed if earlier data has appeared since this was authored, because
-- the era boundary would then be wrong and the uncovered days would be left silently
-- unprojectable, which is the exact defect this migration exists to remove.
--
-- active_to is derived as (earliest existing active_from - 1) rather than hardcoded,
-- so the new row is contiguous with the existing one by construction and cannot
-- overlap it no matter where that boundary sits. Overlap matters because
-- findEffectivePolicy() resolves with ORDER BY active_from DESC LIMIT 1 — an overlap
-- silently picks a winner instead of failing.
--
-- Concurrency: run-pending-migrations.sh takes NO database lock, and the deploy lock
-- it runs under is per-environment ("/tmp/fibreflow-deploy-${TARGET}.lock"). Dev and
-- production therefore hold different locks while sharing one database, so two
-- deploys can apply this file at the same moment. Without serialisation both
-- transactions would read the same MIN(active_from) under READ COMMITTED, both pass
-- the coverage guard, and both insert — producing two overlapping rows, the precise
-- invariant this migration is built on. pg_advisory_xact_lock() closes that window;
-- the second run then observes the committed row and no-ops. The key is the
-- migration number. No other migration in this repo takes an advisory lock yet, so
-- this establishes the convention.
--
-- The schedule matches the current policy. That is not a shortcut: the CHECK
-- constraints on this table pin weekday_unpaid_break_minutes = 60,
-- weekday_paid_cap_hrs = 8, saturday_paid_cap_hrs = 5, sunday_scheduled = false and
-- sunday_missing_out_cap_hrs = 5, so those columns cannot differ per era anyway.
-- The start/end times take the table defaults, which equal the current row's values
-- (08:00-17:00 weekday, 08:00-13:00 Saturday). Confirmed with Hein that these hours
-- were in force April-July.
--
-- The unique index attendance_schedule_policies_one_open permits only one open-ended
-- policy. This row sets active_to, so it is not open-ended and does not contend for
-- that index.
--
-- Re-runnable: the INSERT fires only when the era is not already covered. The
-- post-conditions run on every application, including the no-op path, so a re-run
-- re-verifies the invariants rather than assuming the first run left them intact.
--
-- Everything, including the table comment, lives inside the DO block so the file is
-- atomic under a bare `psql -f` as well as under the runner's `psql -1`. A trailing
-- statement outside the block would still execute after the block raised and rolled
-- back, leaving a comment that claims work the migration did not do.

DO $$
DECLARE
  era_start            CONSTANT DATE := DATE '2026-04-24';
  earliest_active_from DATE;
  latest_active_from   DATE;
  earliest_entry       DATE;
  default_rule_count   BIGINT;
  default_rule_id      UUID;
  new_active_to        DATE;
  uncovered_days       BIGINT;
  overlap_pairs        BIGINT;
BEGIN
  -- Serialise concurrent applications. Held until this transaction commits.
  PERFORM pg_advisory_xact_lock(484);

  SELECT MIN(active_from) INTO earliest_active_from FROM attendance_schedule_policies;

  IF earliest_active_from IS NULL THEN
    RAISE EXCEPTION
      'Migration 484 preflight: attendance_schedule_policies is empty, so there is no cutover boundary to sit before.'
      USING HINT =
        'Migration 475 seeds the "Velocity fixed hours" policy. Apply it before this migration.';
  END IF;

  -- The era boundary is a claim about the data, so re-check it against the data.
  -- attendance_entries may legitimately be empty (a fresh database), which is not
  -- an error; only data EARLIER than the assumed boundary is.
  --
  -- Deliberately unconditional — it runs before the branch that decides whether to
  -- insert, so a re-application over an already-covered era still re-checks the
  -- boundary. That makes repeat application able to fail where it previously could
  -- not, which is the intent: earlier data appearing means the boundary is stale
  -- and the days below it are silently unprojectable, whether or not this
  -- migration has already run once.
  SELECT MIN(work_date) INTO earliest_entry FROM attendance_entries;

  IF earliest_entry IS NOT NULL AND earliest_entry < era_start THEN
    RAISE EXCEPTION
      'Migration 484 preflight: attendance data starts %, which is before this migration''s era_start of %. Those days would be left uncovered.',
      earliest_entry, era_start
      USING HINT =
        'The era boundary was derived from production when this migration was written. '
        'Earlier data has appeared since. Widen era_start to the new earliest work_date '
        'and re-verify the projection impact before applying.';
  END IF;

  EXECUTE $c$
    COMMENT ON TABLE attendance_schedule_policies IS
      'Effective-dated attendance schedules. Rows must not overlap and must leave no '
      'gap: findEffectivePolicy resolves with ORDER BY active_from DESC LIMIT 1, so an '
      'overlap silently picks a winner rather than failing, and a gap makes every day '
      'inside it unprojectable. Migration 484 added the pre-2026-08-03 era, whose '
      'absence made every earlier work date unprojectable.'
  $c$;

  IF earliest_active_from > era_start THEN
    new_active_to := earliest_active_from - 1;

    -- Same one-default-rule assertion migration 475 makes when it seeds the current
    -- policy. overtime_rule_id is NOT NULL, and picking the wrong rule would silently
    -- re-base overtime for the whole historical era.
    SELECT COUNT(*), (ARRAY_AGG(id ORDER BY id))[1]
      INTO default_rule_count, default_rule_id
      FROM attendance_overtime_rules
     WHERE is_default = true;

    IF default_rule_count <> 1 THEN
      RAISE EXCEPTION 'Migration 484 preflight: expected exactly one default overtime rule, found %',
        default_rule_count;
    END IF;

    INSERT INTO attendance_schedule_policies (name, active_from, active_to, overtime_rule_id)
    VALUES ('Velocity fixed hours (pre-cutover)', era_start, new_active_to, default_rule_id);
  END IF;

  -- Post-conditions. These run on the no-op path too, because "some row starts at or
  -- before era_start" does NOT imply the era is actually covered — an interior gap
  -- would satisfy that test while leaving days unprojectable, which is the very
  -- failure being fixed. Asserting the invariant is stronger than asserting the
  -- branch that was taken.
  SELECT MAX(active_from) INTO latest_active_from FROM attendance_schedule_policies;

  -- The upper bound is clamped to at least era_start. generate_series returns ZERO
  -- rows when start > stop, so an unclamped range would make this check degenerate
  -- exactly when it matters most: if every policy starts before era_start and the
  -- latest one also ENDS before it, the whole era is uncovered, no insert happens
  -- (the branch above is skipped), and an empty series would report zero uncovered
  -- days. The clamp guarantees era_start itself is always tested.
  SELECT COUNT(*) INTO uncovered_days
    FROM generate_series(
           era_start::timestamp,
           GREATEST(latest_active_from, era_start)::timestamp,
           INTERVAL '1 day') d(day)
   WHERE NOT EXISTS (
     SELECT 1 FROM attendance_schedule_policies p
      WHERE p.active_from <= d.day::date
        AND (p.active_to IS NULL OR p.active_to >= d.day::date)
   );

  IF uncovered_days > 0 THEN
    RAISE EXCEPTION
      'Migration 484 post-condition: % day(s) between % and % are covered by no schedule policy.',
      uncovered_days, era_start, latest_active_from
      USING HINT =
        'A gap leaves those work dates unprojectable. Resolve the gap by hand — this '
        'migration only fills a contiguous era before the earliest existing policy and '
        'will not guess at an interior gap.';
  END IF;

  SELECT COUNT(*) INTO overlap_pairs
    FROM attendance_schedule_policies a
    JOIN attendance_schedule_policies b ON b.id <> a.id
   WHERE a.active_from <= COALESCE(b.active_to, DATE '9999-12-31')
     AND COALESCE(a.active_to, DATE '9999-12-31') >= b.active_from;

  IF overlap_pairs > 0 THEN
    RAISE EXCEPTION
      'Migration 484 post-condition: schedule policies overlap (% ordered pair(s)).',
      overlap_pairs
      USING HINT =
        'findEffectivePolicy takes ORDER BY active_from DESC LIMIT 1, so an overlap '
        'silently selects one policy over another instead of failing. Resolve by hand.';
  END IF;
END;
$$;

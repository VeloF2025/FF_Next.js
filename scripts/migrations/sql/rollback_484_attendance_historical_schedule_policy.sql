-- Rollback migration 484: remove the pre-cutover attendance schedule policy.
--
-- Reverting restores the state where no work date before 2026-08-03 can be
-- projected: loadEffectivePolicy() throws again for those dates, targeted
-- reconciles over them fail, and every pre-cutover payroll week returns to being
-- unlockable. That is the whole behaviour change, since the row is data rather
-- than schema.
--
-- What it deliberately does NOT do is unwind a projection. If a reconcile has
-- already run against the historical era, attendance_daily_summaries rows carry
-- schedule_policy_id pointing at this policy, and attendance_reconciliation_runs
-- rows do the same. Both foreign keys are NO ACTION, so the DELETE would fail
-- with a bare 23503 naming neither table nor count. This raises first with the
-- counts and the remedy instead.
--
-- Clearing those references is not something a rollback should decide on its own:
-- schedule_policy_id is the record of which schedule priced a day, and blanking
-- it to force the delete through would destroy that provenance for payroll-adjacent
-- rows. The operator has to choose.
--
-- Re-runnable: absent policy is a no-op, and the tracker row is cleared inside the
-- same block so a raise cannot leave the policy present while schema_migrations
-- reports 484 as rolled back. That table is keyed on `filename`, not `version`.

DO $$
DECLARE
  policy_id         UUID;
  summary_refs      BIGINT;
  run_refs          BIGINT;
BEGIN
  SELECT id INTO policy_id
    FROM attendance_schedule_policies
   WHERE name = 'Velocity fixed hours (pre-cutover)';

  IF policy_id IS NULL THEN
    -- Already rolled back. Still clear the tracker so a partially-applied
    -- state converges.
    DELETE FROM schema_migrations
     WHERE filename = '484_attendance_historical_schedule_policy.sql';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO summary_refs
    FROM attendance_daily_summaries WHERE schedule_policy_id = policy_id;
  SELECT COUNT(*) INTO run_refs
    FROM attendance_reconciliation_runs WHERE schedule_policy_id = policy_id;

  IF summary_refs > 0 OR run_refs > 0 THEN
    RAISE EXCEPTION
      'Rollback 484: the pre-cutover policy has been used to project. % attendance_daily_summaries row(s) and % attendance_reconciliation_runs row(s) still reference it.',
      summary_refs, run_refs
      USING HINT =
        'Decide what should happen to those projections first. Clearing schedule_policy_id '
        'discards the record of which schedule priced each day, so it is an explicit '
        'operator decision, not something this rollback performs.';
  END IF;

  DELETE FROM attendance_schedule_policies WHERE id = policy_id;

  DELETE FROM schema_migrations
   WHERE filename = '484_attendance_historical_schedule_policy.sql';
END;
$$;

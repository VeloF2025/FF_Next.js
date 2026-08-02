\set ON_ERROR_STOP on
BEGIN;

SELECT id, timezone, weekday_paid_cap_hrs, saturday_paid_cap_hrs,
       sunday_scheduled, sunday_missing_out_cap_hrs
FROM attendance_schedule_policies
WHERE name = 'Velocity fixed hours'
  AND active_from = DATE '2026-08-03'
  AND active_to IS NULL;

SELECT column_name FROM information_schema.columns
WHERE table_name = 'attendance_daily_summaries'
  AND column_name IN ('result_status', 'result_version', 'calculation_fingerprint');

DO $$
DECLARE
  rejected BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO attendance_schedule_policies (
      name, active_from, weekday_paid_cap_hrs, saturday_paid_cap_hrs,
      sunday_missing_out_cap_hrs, overtime_rule_id
    ) SELECT 'invalid', DATE '2026-08-03', 9, 5, 5, id
      FROM attendance_overtime_rules WHERE is_default = true;
  EXCEPTION WHEN check_violation THEN
    rejected := true;
    RAISE NOTICE 'invalid weekday paid cap rejected as expected';
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'invalid weekday paid cap was accepted';
  END IF;
END;
$$;
ROLLBACK;

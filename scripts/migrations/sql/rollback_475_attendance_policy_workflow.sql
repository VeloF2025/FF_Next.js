-- Rollback 475: remove only the attendance policy/workflow additions.
-- Dependent tables and the daily-summary FK are removed before the policy table.
--
-- Re-runnable: every statement is guarded, and it clears its own schema_migrations row
-- (that table is keyed on `filename`, not `version`). Without that DELETE the schema is
-- rolled back while the tracker still reports the migration as applied, so the forward
-- runner skips it and never repairs the state. Matches rollback_451..457, 461..467, 477.

DROP TABLE IF EXISTS attendance_reconciliation_runs;
DROP TABLE IF EXISTS attendance_notification_dispatches;
DROP TABLE IF EXISTS attendance_payroll_exports;
DROP TABLE IF EXISTS attendance_weekly_lock_history;
DROP TABLE IF EXISTS attendance_decision_events;
DROP TABLE IF EXISTS attendance_day_exceptions;
DROP FUNCTION IF EXISTS prevent_attendance_audit_mutation();

ALTER TABLE attendance_adjustments
  DROP CONSTRAINT IF EXISTS attendance_adjustments_review_fields_paired,
  DROP CONSTRAINT IF EXISTS attendance_adjustments_review_requires_terminal,
  DROP CONSTRAINT IF EXISTS attendance_adjustments_cancel_actor_status,
  DROP COLUMN IF EXISTS cancelled_by_staff_id;

ALTER TABLE attendance_adjustments
  ADD CONSTRAINT attendance_adjustments_review_fields_paired CHECK (
    (reviewed_at IS NULL AND reviewed_by IS NULL)
    OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  ) NOT VALID,
  ADD CONSTRAINT attendance_adjustments_review_requires_terminal CHECK (
    (reviewed_at IS NULL AND status = 'pending')
    OR (reviewed_at IS NOT NULL AND status IN ('approved', 'rejected', 'cancelled'))
  ) NOT VALID;

ALTER TABLE attendance_daily_summaries
  DROP COLUMN IF EXISTS schedule_policy_id,
  DROP COLUMN IF EXISTS scheduled_paid_hrs,
  DROP COLUMN IF EXISTS recorded_elapsed_hrs,
  DROP COLUMN IF EXISTS recorded_paid_hrs,
  DROP COLUMN IF EXISTS proposed_regular_hrs,
  DROP COLUMN IF EXISTS proposed_overtime_hrs,
  DROP COLUMN IF EXISTS proposed_sunday_hrs,
  DROP COLUMN IF EXISTS proposed_holiday_hrs,
  DROP COLUMN IF EXISTS approved_regular_hrs,
  DROP COLUMN IF EXISTS approved_overtime_hrs,
  DROP COLUMN IF EXISTS approved_sunday_hrs,
  DROP COLUMN IF EXISTS approved_holiday_hrs,
  DROP COLUMN IF EXISTS leave_hrs,
  DROP COLUMN IF EXISTS unpaid_hrs,
  DROP COLUMN IF EXISTS attendance_classification,
  DROP COLUMN IF EXISTS result_status,
  DROP COLUMN IF EXISTS blocking_reasons,
  DROP COLUMN IF EXISTS result_version,
  DROP COLUMN IF EXISTS calculation_fingerprint,
  DROP COLUMN IF EXISTS locked_period_version,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approved_by;

DROP TABLE IF EXISTS attendance_schedule_policies;

DELETE FROM schema_migrations WHERE filename = '475_attendance_policy_workflow.sql';

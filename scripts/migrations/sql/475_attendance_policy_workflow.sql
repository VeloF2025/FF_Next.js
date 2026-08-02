-- Migration 475: Attendance policy, approval workflow, and audit schema.
-- Raw attendance_entries remain immutable clock evidence; this adds derived
-- policy/result metadata and append-only workflow/audit records only.
-- Task 1 contains no service write path and implements no JSON payload validation.
-- The approved plan assigns Task 3's jsonPayloadValidation module to reject
-- serialized JSONB values above 1,048,576 UTF-8 bytes before SQL execution.

CREATE TABLE IF NOT EXISTS attendance_schedule_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
  active_from DATE NOT NULL,
  active_to DATE,
  weekday_start TIME NOT NULL DEFAULT '08:00',
  weekday_end TIME NOT NULL DEFAULT '17:00',
  weekday_unpaid_break_minutes INT NOT NULL DEFAULT 60 CHECK (weekday_unpaid_break_minutes = 60),
  weekday_paid_cap_hrs NUMERIC(4,2) NOT NULL DEFAULT 8 CHECK (weekday_paid_cap_hrs = 8),
  saturday_start TIME NOT NULL DEFAULT '08:00',
  saturday_end TIME NOT NULL DEFAULT '13:00',
  saturday_paid_cap_hrs NUMERIC(4,2) NOT NULL DEFAULT 5 CHECK (saturday_paid_cap_hrs = 5),
  sunday_scheduled BOOLEAN NOT NULL DEFAULT false CHECK (sunday_scheduled = false),
  sunday_missing_out_cap_hrs NUMERIC(4,2) NOT NULL DEFAULT 5 CHECK (sunday_missing_out_cap_hrs = 5),
  late_alert_minutes INT NOT NULL DEFAULT 15 CHECK (late_alert_minutes >= 0),
  overtime_rule_id UUID NOT NULL REFERENCES attendance_overtime_rules(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (active_to IS NULL OR active_to >= active_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_schedule_policies_one_open
  ON attendance_schedule_policies ((active_to IS NULL)) WHERE active_to IS NULL;

ALTER TABLE attendance_daily_summaries
  ADD COLUMN IF NOT EXISTS schedule_policy_id UUID REFERENCES attendance_schedule_policies(id),
  ADD COLUMN IF NOT EXISTS scheduled_paid_hrs NUMERIC(5,2) CHECK (scheduled_paid_hrs BETWEEN 0 AND 24),
  ADD COLUMN IF NOT EXISTS recorded_elapsed_hrs NUMERIC(5,2) CHECK (recorded_elapsed_hrs BETWEEN 0 AND 24),
  ADD COLUMN IF NOT EXISTS recorded_paid_hrs NUMERIC(5,2) CHECK (recorded_paid_hrs BETWEEN 0 AND 24),
  ADD COLUMN IF NOT EXISTS proposed_regular_hrs NUMERIC(5,2) CHECK (proposed_regular_hrs BETWEEN 0 AND 24),
  ADD COLUMN IF NOT EXISTS proposed_overtime_hrs NUMERIC(5,2) CHECK (proposed_overtime_hrs BETWEEN 0 AND 15),
  ADD COLUMN IF NOT EXISTS proposed_sunday_hrs NUMERIC(5,2) CHECK (proposed_sunday_hrs BETWEEN 0 AND 24),
  ADD COLUMN IF NOT EXISTS proposed_holiday_hrs NUMERIC(5,2) CHECK (proposed_holiday_hrs BETWEEN 0 AND 24),
  ADD COLUMN IF NOT EXISTS approved_regular_hrs NUMERIC(5,2) CHECK (approved_regular_hrs BETWEEN 0 AND 24),
  ADD COLUMN IF NOT EXISTS approved_overtime_hrs NUMERIC(5,2) CHECK (approved_overtime_hrs BETWEEN 0 AND 15),
  ADD COLUMN IF NOT EXISTS approved_sunday_hrs NUMERIC(5,2) CHECK (approved_sunday_hrs BETWEEN 0 AND 24),
  ADD COLUMN IF NOT EXISTS approved_holiday_hrs NUMERIC(5,2) CHECK (approved_holiday_hrs BETWEEN 0 AND 24),
  ADD COLUMN IF NOT EXISTS leave_hrs NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (leave_hrs BETWEEN 0 AND 24),
  ADD COLUMN IF NOT EXISTS unpaid_hrs NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (unpaid_hrs BETWEEN 0 AND 24),
  ADD COLUMN IF NOT EXISTS attendance_classification TEXT,
  ADD COLUMN IF NOT EXISTS result_status TEXT,
  ADD COLUMN IF NOT EXISTS blocking_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS result_version BIGINT NOT NULL DEFAULT 1 CHECK (result_version > 0),
  ADD COLUMN IF NOT EXISTS calculation_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS locked_period_version BIGINT CHECK (locked_period_version > 0),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);

ALTER TABLE attendance_daily_summaries
  ADD CONSTRAINT attendance_daily_summaries_result_status_check CHECK (
    result_status IS NULL OR result_status IN (
      'expected', 'open', 'complete', 'provisional', 'awaiting_worker',
      'awaiting_supervisor', 'approved', 'locked', 'absence_review'
    )
  ),
  ADD CONSTRAINT attendance_daily_summaries_classification_check CHECK (
    attendance_classification IS NULL OR attendance_classification IN (
      'approved_leave', 'sick_leave', 'site_shutdown_weather',
      'public_holiday', 'unauthorised_absence'
    )
  );

-- A portal worker is a staff identity and may not have a linked users row.
-- Keep supervisor review identity in reviewed_by (users.id), while recording
-- a worker's own cancellation in the correct staff identity domain.
ALTER TABLE attendance_adjustments
  ADD COLUMN IF NOT EXISTS cancelled_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL;

ALTER TABLE attendance_adjustments
  DROP CONSTRAINT IF EXISTS attendance_adjustments_review_fields_paired,
  DROP CONSTRAINT IF EXISTS attendance_adjustments_review_requires_terminal,
  DROP CONSTRAINT IF EXISTS attendance_adjustments_cancel_actor_status;

ALTER TABLE attendance_adjustments
  ADD CONSTRAINT attendance_adjustments_review_fields_paired CHECK (
    (reviewed_at IS NULL AND reviewed_by IS NULL AND cancelled_by_staff_id IS NULL)
    OR (reviewed_at IS NOT NULL AND (
      (reviewed_by IS NOT NULL AND cancelled_by_staff_id IS NULL)
      OR (reviewed_by IS NULL AND cancelled_by_staff_id IS NOT NULL)
    ))
  ),
  ADD CONSTRAINT attendance_adjustments_review_requires_terminal CHECK (
    (reviewed_at IS NULL AND status = 'pending')
    OR (reviewed_at IS NOT NULL AND status IN ('approved', 'rejected', 'cancelled'))
  ),
  ADD CONSTRAINT attendance_adjustments_cancel_actor_status CHECK (
    cancelled_by_staff_id IS NULL OR status = 'cancelled'
  );

CREATE TABLE IF NOT EXISTS attendance_day_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  entry_id UUID REFERENCES attendance_entries(id) ON DELETE SET NULL,
  adjustment_id UUID REFERENCES attendance_adjustments(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'missing_clock_in', 'missing_clock_out', 'late_arrival', 'early_departure',
    'outside_schedule', 'sunday_work', 'public_holiday_work', 'evidence_unreliable'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'open', 'awaiting_worker', 'awaiting_supervisor', 'resolved', 'cancelled'
  )),
  owner_user_id UUID REFERENCES users(id),
  proposed_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  classification TEXT CHECK (classification IN (
    'approved_leave', 'sick_leave', 'site_shutdown_weather',
    'public_holiday', 'unauthorised_absence'
  )),
  idempotency_key TEXT NOT NULL,
  result_version BIGINT NOT NULL CHECK (result_version > 0),
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  resolution_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS attendance_decision_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'day_exception', 'daily_result', 'weekly_lock', 'payroll_export'
  )),
  entity_key TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id),
  actor_staff_id UUID REFERENCES staff(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  before_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance_weekly_lock_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start_date DATE NOT NULL CHECK (EXTRACT(DOW FROM week_start_date) = 1),
  lock_version BIGINT NOT NULL CHECK (lock_version > 0),
  action TEXT NOT NULL CHECK (action IN ('lock', 'unlock', 'relock')),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
  result_snapshot JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (week_start_date, lock_version, action)
);

CREATE OR REPLACE FUNCTION prevent_attendance_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'attendance audit table % is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS attendance_decision_events_immutable
  ON attendance_decision_events;
CREATE TRIGGER attendance_decision_events_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON attendance_decision_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_attendance_audit_mutation();

DROP TRIGGER IF EXISTS attendance_weekly_lock_history_immutable
  ON attendance_weekly_lock_history;
CREATE TRIGGER attendance_weekly_lock_history_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON attendance_weekly_lock_history
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_attendance_audit_mutation();

CREATE TABLE IF NOT EXISTS attendance_payroll_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start_date DATE NOT NULL CHECK (EXTRACT(DOW FROM week_start_date) = 1),
  lock_version BIGINT NOT NULL CHECK (lock_version > 0),
  format TEXT NOT NULL CHECK (format IN ('csv', 'xlsx')),
  status TEXT NOT NULL CHECK (status IN ('generating', 'ready', 'failed')),
  generated_by UUID NOT NULL REFERENCES users(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  row_count INT NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  sha256 TEXT,
  storage_path TEXT,
  error_message TEXT,
  UNIQUE (week_start_date, lock_version, format)
);

CREATE TABLE IF NOT EXISTS attendance_notification_dispatches (
  delivery_key TEXT PRIMARY KEY,
  phase TEXT NOT NULL CHECK (phase IN ('morning', 'clockout', 'digest', 'weekly')),
  source_key TEXT NOT NULL,
  recipient_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('claimed', 'accepted', 'failed')),
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance_reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL UNIQUE,
  scanned_from DATE NOT NULL,
  scanned_to DATE NOT NULL,
  schedule_policy_id UUID REFERENCES attendance_schedule_policies(id),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  failed_day_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  CHECK (scanned_to >= scanned_from)
);

CREATE INDEX IF NOT EXISTS idx_attendance_day_exceptions_unresolved_owner_date
  ON attendance_day_exceptions(owner_user_id, work_date)
  WHERE status IN ('open', 'awaiting_worker', 'awaiting_supervisor');
CREATE INDEX IF NOT EXISTS idx_attendance_day_exceptions_staff_date
  ON attendance_day_exceptions(staff_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_decision_events_entity
  ON attendance_decision_events(entity_type, entity_key, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_weekly_lock_history_week_version
  ON attendance_weekly_lock_history(week_start_date, lock_version);
CREATE INDEX IF NOT EXISTS idx_attendance_notification_dispatches_status
  ON attendance_notification_dispatches(status, created_at);
CREATE INDEX IF NOT EXISTS idx_attendance_reconciliation_runs_status_finished
  ON attendance_reconciliation_runs(status, finished_at DESC);

-- Work dates are Africa/Johannesburg calendar dates. The approved phase-1
-- policy is effective from Monday 2026-08-03 SAST, matching the default
-- reconciliation lower bound. Ambiguous or absent default rules must abort.
DO $$
DECLARE
  default_overtime_rule_count BIGINT;
  default_overtime_rule_id UUID;
BEGIN
  SELECT COUNT(*), (ARRAY_AGG(id ORDER BY id))[1]
    INTO default_overtime_rule_count, default_overtime_rule_id
    FROM attendance_overtime_rules
   WHERE is_default = true;

  IF default_overtime_rule_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one default overtime rule, found %',
      default_overtime_rule_count;
  END IF;

  INSERT INTO attendance_schedule_policies (name, active_from, overtime_rule_id)
  SELECT 'Velocity fixed hours', DATE '2026-08-03', default_overtime_rule_id
  WHERE NOT EXISTS (
    SELECT 1 FROM attendance_schedule_policies WHERE name = 'Velocity fixed hours'
  );
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_schedule_policies TO fibreflow_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_day_exceptions TO fibreflow_user;
REVOKE UPDATE, DELETE, TRUNCATE ON attendance_decision_events FROM fibreflow_user;
GRANT SELECT, INSERT ON attendance_decision_events TO fibreflow_user;
REVOKE UPDATE, DELETE, TRUNCATE ON attendance_weekly_lock_history FROM fibreflow_user;
GRANT SELECT, INSERT ON attendance_weekly_lock_history TO fibreflow_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_payroll_exports TO fibreflow_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_notification_dispatches TO fibreflow_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_reconciliation_runs TO fibreflow_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_daily_summaries TO fibreflow_user;

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'scripts/migrations/sql/475_attendance_policy_workflow.sql',
  'utf8'
);
const rollback = readFileSync(
  'scripts/migrations/sql/rollback_475_attendance_policy_workflow.sql',
  'utf8'
);
const probe = readFileSync(
  'scripts/probes/verify-attendance-policy-workflow.sql',
  'utf8'
);
const plan = readFileSync(
  'docs/superpowers/plans/2026-08-01-workforce-platform-phase1-attendance-integrity.md',
  'utf8'
);

const workflowTables = [
  'attendance_schedule_policies',
  'attendance_day_exceptions',
  'attendance_decision_events',
  'attendance_weekly_lock_history',
  'attendance_payroll_exports',
  'attendance_notification_dispatches',
  'attendance_reconciliation_runs',
];

const addedSummaryColumns = [
  'schedule_policy_id', 'scheduled_paid_hrs', 'recorded_elapsed_hrs',
  'recorded_paid_hrs', 'proposed_regular_hrs', 'proposed_overtime_hrs',
  'proposed_sunday_hrs', 'proposed_holiday_hrs', 'approved_regular_hrs',
  'approved_overtime_hrs', 'approved_sunday_hrs', 'approved_holiday_hrs',
  'leave_hrs', 'unpaid_hrs', 'attendance_classification', 'result_status',
  'blocking_reasons', 'result_version', 'calculation_fingerprint',
  'locked_period_version', 'approved_at', 'approved_by',
];

describe('attendance policy workflow migration contract', () => {
  it('uses collision-free attendance migration numbers 475 and 476 after metrics migration 474', () => {
    const migrationFiles = readdirSync('scripts/migrations/sql').filter((file) =>
      /^\d+_attendance_(policy_workflow|lock_hr_authority)\.sql$/.test(file)
    );

    expect(migrationFiles.sort()).toEqual([
      '475_attendance_policy_workflow.sql',
      '476_attendance_lock_hr_authority.sql',
    ]);
  });

  it('creates every required policy and audit object', () => {
    for (const table of workflowTables) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(migration).toContain('UNIQUE (idempotency_key)');
  });

  it('enforces the approved fixed-hours policy and daily result states', () => {
    for (const clause of [
      "timezone TEXT NOT NULL DEFAULT 'Africa/Johannesburg'",
      "weekday_start TIME NOT NULL DEFAULT '08:00'",
      "weekday_end TIME NOT NULL DEFAULT '17:00'",
      'weekday_unpaid_break_minutes = 60',
      'weekday_paid_cap_hrs = 8',
      "saturday_start TIME NOT NULL DEFAULT '08:00'",
      "saturday_end TIME NOT NULL DEFAULT '13:00'",
      'saturday_paid_cap_hrs = 5',
      'sunday_scheduled = false',
      'sunday_missing_out_cap_hrs = 5',
      'late_alert_minutes >= 0',
      'CHECK (active_to IS NULL OR active_to >= active_from)',
      "'expected', 'open', 'complete', 'provisional', 'awaiting_worker'",
      "'awaiting_supervisor', 'approved', 'locked', 'absence_review'",
      "'approved_leave', 'sick_leave', 'site_shutdown_weather'",
      "'public_holiday', 'unauthorised_absence'",
    ]) expect(migration).toContain(clause);
    for (const column of addedSummaryColumns) {
      expect(migration).toContain(column);
    }
  });

  it('seeds the policy from exactly one default overtime rule on the approved SAST date', () => {
    expect(migration).toContain("DATE '2026-08-03'");
    expect(migration).not.toContain('CURRENT_DATE');
    expect(migration).toMatch(/IF default_overtime_rule_count <> 1 THEN/);
    expect(migration).toMatch(
      /RAISE EXCEPTION 'Expected exactly one default overtime rule, found %'/
    );
    expect(probe).toContain("active_from = DATE '2026-08-03'");
    expect(probe).not.toContain('CURRENT_DATE');
  });

  it('includes required indexes and explicit runtime grants', () => {
    for (const index of [
      'attendance_schedule_policies_one_open',
      'idx_attendance_day_exceptions_unresolved_owner_date',
      'idx_attendance_day_exceptions_staff_date',
      'idx_attendance_decision_events_entity',
      'idx_attendance_weekly_lock_history_week_version',
      'idx_attendance_notification_dispatches_status',
      'idx_attendance_reconciliation_runs_status_finished',
    ]) expect(migration).toContain(index);
    for (const table of [
      'attendance_schedule_policies',
      'attendance_day_exceptions',
      'attendance_payroll_exports',
      'attendance_notification_dispatches',
      'attendance_reconciliation_runs',
      'attendance_daily_summaries',
    ]) {
      expect(migration).toContain(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO fibreflow_user;`
      );
    }
  });

  it.each([
    'attendance_decision_events',
    'attendance_weekly_lock_history',
  ])('makes %s append-only for runtime and at the database boundary', (table) => {
    expect(migration).toContain(
      `GRANT SELECT, INSERT ON ${table} TO fibreflow_user;`
    );
    expect(migration).not.toMatch(
      new RegExp(`GRANT [^;]*(?:UPDATE|DELETE|TRUNCATE)[^;]* ON ${table}\\b`, 'i')
    );
    expect(migration).toMatch(
      new RegExp(
        `CREATE TRIGGER ${table}_immutable[\\s\\S]*?BEFORE UPDATE OR DELETE OR TRUNCATE[\\s\\S]*?ON ${table}[\\s\\S]*?FOR EACH STATEMENT[\\s\\S]*?EXECUTE FUNCTION prevent_attendance_audit_mutation\\(\\)`
      )
    );
  });

  it('rejects every non-insert mutation of immutable attendance audit rows', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION prevent_attendance_audit_mutation\(\)[\s\S]*?RETURNS TRIGGER/
    );
    expect(migration).toMatch(
      /RAISE EXCEPTION 'attendance audit table % is append-only'/
    );
  });

  it('records worker cancellation identity without crossing the users foreign key domain', () => {
    expect(migration).toMatch(
      /attendance_adjustments[\s\S]*?ADD COLUMN IF NOT EXISTS cancelled_by_staff_id UUID REFERENCES staff\(id\)/i,
    );
    expect(migration).toMatch(
      /cancelled_by_staff_id IS NULL OR status = 'cancelled'/i,
    );
    expect(rollback).toContain('DROP COLUMN IF EXISTS cancelled_by_staff_id');
  });

  it('rolls back every daily-summary addition before the policy table', () => {
    for (const column of addedSummaryColumns) {
      expect(rollback).toContain(`DROP COLUMN IF EXISTS ${column}`);
    }
    expect(rollback.indexOf('DROP COLUMN IF EXISTS schedule_policy_id')).toBeLessThan(
      rollback.indexOf('DROP TABLE IF EXISTS attendance_schedule_policies')
    );
  });

  it('uses a controlled check-violation probe and defers JSON validation to Task 3', () => {
    expect(probe).toContain('EXCEPTION WHEN check_violation THEN');
    expect(probe).toContain('ROLLBACK;');
    expect(migration).toContain('Task 1 contains no service write path');
    expect(plan).toContain('src/services/attendance/policy/jsonPayloadValidation.ts');
    expect(plan).toContain('src/services/attendance/policy/__tests__/jsonPayloadValidation.test.ts');
    expect(plan).toContain('1,048,576 bytes');
    expect(plan).toContain('before SQL execution');
  });
});

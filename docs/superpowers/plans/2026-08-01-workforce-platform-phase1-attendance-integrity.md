# Attendance Integrity and Payroll Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a schedule-aware, auditable attendance workflow that forces missing-clock corrections, routes exceptions through supervisors and HR, and exports only locked payroll-ready hours.

**Architecture:** Keep `attendance_entries` as clock evidence, add an effective-dated schedule policy and approval-aware fields to `attendance_daily_summaries`, and represent no-punch days in a separate day-exception table. A pure policy calculator feeds an idempotent reconciliation service; thin APIs and focused UI components expose worker, supervisor and HR states without calculating payroll in the browser.

**Tech Stack:** Next.js Pages Router, React, TypeScript, PostgreSQL via `@/lib/db-pool`, Vitest, Playwright, XLSX, existing `/my` PWA, existing PostgreSQL RBAC and unified notifications.

## Global Constraints

- Work only in an isolated worktree and deliver every code change through a pull request; never commit to `master`.
- Do not apply the schema migration to the shared FibreFlow database without Hein's explicit migration approval.
- Do not deploy production without Hein's explicit approval, and never during 08:00–17:00 SAST Monday–Friday.
- All attendance policy evaluation uses `Africa/Johannesburg` and explicit `YYYY-MM-DD` work dates.
- Monday–Friday is 08:00–17:00 with one unpaid lunch hour and eight scheduled paid hours.
- Saturday is 08:00–13:00 with five scheduled paid hours and no lunch deduction.
- Sunday has no scheduled absence; worked Sunday time requires supervisor approval.
- Missing clock-out fallback is provisional and capped at eight paid hours Monday–Friday and five paid hours Saturday/Sunday.
- Before-08:00, after-17:00 weekday and after-13:00 Saturday time is provisional overtime requiring supervisor approval.
- Late/early records create flags; FibreFlow must not make an automatic payroll deduction.
- A missing prior clock-out blocks the next clock-in only until the worker persists a correction; supervisor review may remain pending.
- Supervisors decide daily exceptions; HR controls readiness, lock/unlock and export.
- Raw clock evidence is never rewritten to make an adjustment appear original.
- GPS, geofence, selfie and Cartrack are corroborating evidence, not automatic fraud or payroll decisions.
- Tax, payslip generation, monetary payroll calculations and payment execution remain outside FibreFlow.
- New code uses `apiResponse`, `log`, `@/lib/db-pool`, explicit SQL branches and the existing `AttendanceNav`; no sidebar subtree.
- Files stay under 300 lines and React components under 200 lines. Split existing oversized pages when modifying them.
- Every UI success state waits for API confirmation and persisted-state readback.
- Run `npm run ci:quick`, focused Vitest suites and the specified Playwright journeys before the pull request is ready for review.

---

## File and responsibility map

### Database and policy

- `scripts/migrations/sql/475_attendance_policy_workflow.sql` — additive schedule, daily-result, exception, decision, lock-history, notification-dispatch and export schema.
- `scripts/migrations/sql/rollback_475_attendance_policy_workflow.sql` — remove only migration 475 additions.
- `scripts/probes/verify-attendance-policy-workflow.sql` — real PostgreSQL positive/negative constraint and readback probe.
- `src/services/attendance/policy/types.ts` — policy input/output and state types.
- `src/services/attendance/policy/defaultPolicy.ts` — approved default policy and effective-policy loader mapping.
- `src/services/attendance/policy/calculateDailyResult.ts` — pure daily calculation; no SQL or notification calls.
- `src/services/attendance/policy/projectionRepository.ts` — transaction-safe policy/result/exception persistence.

### Reconciliation and workflow

- `src/services/attendance/reconcile.ts` — orchestration only; call the new policy and persistence units.
- `src/services/attendance/reconcileQueries.ts` — evidence and expected-worker reads.
- `src/services/attendance/reconcileWriters.ts` — system-close and legacy summary compatibility writes.
- `src/modules/attendance/workflow/types.ts` — API-facing exception/readiness types.
- `src/modules/attendance/workflow/dayExceptionQueries.ts` — scoped queue and day-exception commands.
- `src/modules/attendance/workflow/periodQueries.ts` — readiness, decision, lock history and export-version queries.
- `src/modules/attendance/workflow/requiredActionQueries.ts` — worker missing-clock correction gate.
- `src/modules/attendance/workflow/notificationService.ts` — idempotent attendance notification ledger + unified bus calls.
- `src/modules/attendance/portal/clockInCommand.ts` — clock-in orchestration extracted from the oversized API route.

### APIs and UI

- `pages/api/my/hub-summary.ts`, `pages/api/my/attendance/current.ts` and `pages/api/my/attendance/clock-in.ts` — expose schedule/result state and enforce prior required action.
- `pages/api/my/attendance-corrections.ts` — atomically submit missing-clock correction and advance its day exception.
- `pages/api/staff/attendance-day-exceptions.ts` — scoped supervisor queue.
- `pages/api/staff/attendance-day-exceptions-review.ts` — scoped, versioned supervisor decisions.
- `pages/api/staff/attendance-period-readiness.ts` — HR blocking/readiness view.
- `pages/api/staff/attendance-weekly-locks.ts` — readiness-gated lock and audited unlock/re-lock.
- `pages/api/staff/attendance-export.ts` — thin compatibility handler around deterministic export service.
- `src/modules/attendance/portal/client/AttendanceRequiredActionCard.tsx` — worker action summary.
- `src/modules/attendance/portal/client/useMyHubData.ts` — data/effect logic extracted so `MyHub` remains a focused component.
- `pages/my/attendance/corrections/new.tsx` — missing-clock correction mode and post-submit unlock confirmation.
- `src/components/attendance/actions/*` — supervisor summary, queue, detail and decision components.
- `pages/staff/attendance/corrections.tsx` — thin supervisor action-queue page.
- `src/components/attendance/readiness/*` — HR readiness, blockers and lock controls.
- `pages/staff/attendance/locks.tsx` and `pages/staff/attendance/week.tsx` — thin HR shells.
- `src/services/attendance/payroll/*` — locked row selection, deterministic serialization and checksum.
- `scripts/cron/attendance-notifications.ts` — morning, clock-out, digest and weekly notification phases.
- `src/services/attendance/reports/*` — new exception, readiness and evidence-quality report modules.
- `tests/e2e/attendance-workforce-phase1.spec.ts` — full worker/supervisor/HR journeys.
- `docs/operations/attendance-workforce-phase1.md` — approved migration, cron, shadow, pilot, cutover and rollback runbook.

---

### Task 1: Add the attendance policy and audit schema

**Files:**
- Create: `scripts/migrations/sql/475_attendance_policy_workflow.sql`
- Create: `scripts/migrations/sql/rollback_475_attendance_policy_workflow.sql`
- Create: `scripts/probes/verify-attendance-policy-workflow.sql`
- Create: `src/services/attendance/__tests__/policySchema.contract.test.ts`

**Interfaces:**
- Consumes: existing `attendance_entries`, `attendance_daily_summaries`, `attendance_overtime_rules`, `attendance_weekly_locks`, `staff`, `users`.
- Produces: `attendance_schedule_policies`, `attendance_day_exceptions`, `attendance_decision_events`, `attendance_weekly_lock_history`, `attendance_payroll_exports`, `attendance_notification_dispatches`, `attendance_reconciliation_runs`, and approval-aware daily-summary columns used by Tasks 2–14.

**Write-path boundary:** Task 1 contains no service write path and therefore does not implement JSON payload validation. Task 3 owns the first executable validation at policy/workflow persistence boundaries.

- [ ] **Step 1: Write the failing migration contract test**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'scripts/migrations/sql/475_attendance_policy_workflow.sql',
  'utf8'
);
const rollback = readFileSync(
  'scripts/migrations/sql/rollback_475_attendance_policy_workflow.sql',
  'utf8'
);

describe('attendance policy workflow migration contract', () => {
  it('creates every required policy and audit object', () => {
    for (const name of [
      'attendance_schedule_policies',
      'attendance_day_exceptions',
      'attendance_decision_events',
      'attendance_weekly_lock_history',
      'attendance_payroll_exports',
      'attendance_notification_dispatches',
      'attendance_reconciliation_runs',
    ]) expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${name}`);
    expect(migration).toContain('result_status');
    expect(migration).toContain('calculation_fingerprint');
    expect(migration).toContain('UNIQUE (idempotency_key)');
  });

  it('grants the runtime role and supplies a complete rollback', () => {
    expect(migration).toContain('TO fibreflow_user');
    expect(rollback).toContain('DROP TABLE IF EXISTS attendance_payroll_exports');
    expect(rollback).toContain('DROP TABLE IF EXISTS attendance_notification_dispatches');
    expect(rollback).toContain('DROP TABLE IF EXISTS attendance_reconciliation_runs');
    expect(rollback).toContain('DROP COLUMN IF EXISTS schedule_policy_id');
  });
});
```

- [ ] **Step 2: Run the test and verify the missing files fail**

Run: `npx vitest run src/services/attendance/__tests__/policySchema.contract.test.ts`

Expected: FAIL because migration 475 does not exist.

- [ ] **Step 3: Write the additive migration and rollback**

Use these exact states and checks:

```sql
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
```

Add CHECKs for `result_status` over `expected`, `open`, `complete`, `provisional`, `awaiting_worker`, `awaiting_supervisor`, `approved`, `locked`, and `absence_review`, and for `attendance_classification` over `approved_leave`, `sick_leave`, `site_shutdown_weather`, `public_holiday`, `unauthorised_absence` or NULL.

Create the workflow/audit tables with these exact columns and states:

```sql
CREATE TABLE IF NOT EXISTS attendance_day_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  entry_id UUID REFERENCES attendance_entries(id) ON DELETE SET NULL,
  adjustment_id UUID REFERENCES attendance_adjustments(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'missing_clock_in','missing_clock_out','late_arrival','early_departure',
    'outside_schedule','sunday_work','public_holiday_work','evidence_unreliable'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'open','awaiting_worker','awaiting_supervisor','resolved','cancelled'
  )),
  owner_user_id UUID REFERENCES users(id),
  proposed_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  classification TEXT CHECK (classification IN (
    'approved_leave','sick_leave','site_shutdown_weather',
    'public_holiday','unauthorised_absence'
  )),
  idempotency_key TEXT NOT NULL UNIQUE,
  result_version BIGINT NOT NULL CHECK (result_version > 0),
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  resolution_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance_decision_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'day_exception','daily_result','weekly_lock','payroll_export'
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
  action TEXT NOT NULL CHECK (action IN ('lock','unlock','relock')),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
  result_snapshot JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (week_start_date, lock_version, action)
);

CREATE TABLE IF NOT EXISTS attendance_payroll_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start_date DATE NOT NULL CHECK (EXTRACT(DOW FROM week_start_date) = 1),
  lock_version BIGINT NOT NULL CHECK (lock_version > 0),
  format TEXT NOT NULL CHECK (format IN ('csv','xlsx')),
  status TEXT NOT NULL CHECK (status IN ('generating','ready','failed')),
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
  phase TEXT NOT NULL CHECK (phase IN ('morning','clockout','digest','weekly')),
  source_key TEXT NOT NULL,
  recipient_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('claimed','accepted','failed')),
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
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','partial','failed')),
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  failed_day_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  CHECK (scanned_to >= scanned_from)
);
```

Add indexes for unresolved owner/date, staff/date, decision entity, lock week/version, notification status and reconciliation `(status, finished_at DESC)`. Task 1 contains no service write path and therefore does not implement JSON payload validation; Task 3 owns that executable requirement. Seed one `Velocity fixed hours` policy with the approved 2026-08-03 SAST effective date, abort unless exactly one existing default overtime rule resolves, and enforce decision-event/lock-history append-only behavior with `SELECT, INSERT` grants plus database triggers. Other runtime tables retain explicit CRUD. The rollback drops new tables in FK-safe reverse order, drops the mutation-guard function, then drops every added daily-summary column.

The seed decision is fixed at 2026-08-03 SAST rather than migration execution time. Zero or multiple default overtime rules are migration errors, and immutable audit/history tables expose only `SELECT, INSERT` to `fibreflow_user`.

- [ ] **Step 4: Write the real PostgreSQL verification probe**

```sql
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
  AND column_name IN ('result_status','result_version','calculation_fingerprint');
SAVEPOINT negative_cap;
INSERT INTO attendance_schedule_policies (
  name, active_from, weekday_paid_cap_hrs, saturday_paid_cap_hrs,
  sunday_missing_out_cap_hrs, overtime_rule_id
) SELECT 'invalid', DATE '2026-08-03', 9, 5, 5, id
  FROM attendance_overtime_rules WHERE is_default = true;
ROLLBACK TO negative_cap;
ROLLBACK;
```

Run only on an approved disposable/DEV database after applying migration 475:
`psql "$ATTENDANCE_SCHEMA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/probes/verify-attendance-policy-workflow.sql`

Expected: valid policy/columns print, invalid 9-hour weekday cap is rejected, and the outer transaction rolls back.

- [ ] **Step 5: Run contract checks and commit**

Run: `npx vitest run src/services/attendance/__tests__/policySchema.contract.test.ts && git diff --check`

Expected: PASS. Record the real PostgreSQL probe as pending until an approved test database is supplied; do not describe the contract test as DB proof.

```bash
git add scripts/migrations/sql/475_attendance_policy_workflow.sql scripts/migrations/sql/rollback_475_attendance_policy_workflow.sql scripts/probes/verify-attendance-policy-workflow.sql src/services/attendance/__tests__/policySchema.contract.test.ts
git commit -m "feat(attendance): add policy workflow schema"
```

### Task 2: Build the pure schedule-aware daily calculator

**Files:**
- Create: `src/services/attendance/policy/types.ts`
- Create: `src/services/attendance/policy/defaultPolicy.ts`
- Create: `src/services/attendance/policy/calculateDailyResult.ts`
- Create: `src/services/attendance/policy/__tests__/calculateDailyResult.test.ts`

**Interfaces:**
- Consumes: `AttendanceSchedulePolicy`, work date, genuine/system clock evidence and public-holiday flag.
- Produces: `calculateDailyResult(input: CalculateDailyResultInput): CalculatedDailyResult` for Task 3 persistence and Task 4 reconciliation.

- [ ] **Step 1: Define the domain types in the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { VELOCITY_FIXED_POLICY } from '../defaultPolicy';
import { calculateDailyResult } from '../calculateDailyResult';

const pair = (workDate: string, clockInAt: string, clockOutAt: string | null) => ({
  workDate,
  clockInAt: new Date(clockInAt),
  clockOutAt: clockOutAt ? new Date(clockOutAt) : null,
  clockOutSource: clockOutAt ? ('device' as const) : null,
});

describe('calculateDailyResult', () => {
  it('returns an approved eight-hour clean weekday', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-03', '2026-08-03T06:00:00Z', '2026-08-03T15:00:00Z'),
      isPublicHoliday: false,
    });
    expect(result).toMatchObject({
      scheduledPaidHours: 8,
      recordedElapsedHours: 9,
      proposedRegularHours: 8,
      status: 'approved',
      exceptionKinds: [],
    });
  });

  it('caps missing weekday clock-out and requires worker action', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-03', '2026-08-03T06:00:00Z', null),
      isPublicHoliday: false,
    });
    expect(result.status).toBe('awaiting_worker');
    expect(result.proposedRegularHours).toBe(8);
    expect(result.exceptionKinds).toEqual(['missing_clock_out']);
  });

  it('creates no Sunday absence but requires approval for Sunday work', () => {
    expect(calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: { workDate: '2026-08-02', clockInAt: null, clockOutAt: null, clockOutSource: null },
      isPublicHoliday: false,
    }).exceptionKinds).toEqual([]);
    expect(calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-02', '2026-08-02T06:00:00Z', '2026-08-02T11:00:00Z'),
      isPublicHoliday: false,
    })).toMatchObject({ status: 'awaiting_supervisor', proposedSundayHours: 5 });
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npx vitest run src/services/attendance/policy/__tests__/calculateDailyResult.test.ts`

Expected: FAIL because the policy modules do not exist.

- [ ] **Step 3: Implement the exact calculator interface**

```ts
export type DailyResultStatus =
  | 'expected' | 'open' | 'complete' | 'provisional'
  | 'awaiting_worker' | 'awaiting_supervisor'
  | 'approved' | 'locked' | 'absence_review';

export type DayExceptionKind =
  | 'missing_clock_in' | 'missing_clock_out'
  | 'late_arrival' | 'early_departure'
  | 'outside_schedule' | 'sunday_work'
  | 'public_holiday_work' | 'evidence_unreliable';

export type AttendanceClassification =
  | 'approved_leave' | 'sick_leave' | 'site_shutdown_weather'
  | 'public_holiday' | 'unauthorised_absence';

export interface AttendanceSchedulePolicy {
  id: string;
  timezone: 'Africa/Johannesburg';
  weekdayStart: '08:00';
  weekdayEnd: '17:00';
  weekdayUnpaidBreakMinutes: 60;
  weekdayPaidCapHours: 8;
  saturdayStart: '08:00';
  saturdayEnd: '13:00';
  saturdayPaidCapHours: 5;
  sundayScheduled: false;
  sundayMissingOutCapHours: 5;
  lateAlertMinutes: 15;
}

export interface ClockEvidence {
  workDate: string;
  clockInAt: Date | null;
  clockOutAt: Date | null;
  clockOutSource: 'device' | 'system' | 'manual' | null;
}

export interface CalculatedDailyResult {
  workDate: string;
  scheduledPaidHours: number;
  recordedElapsedHours: number | null;
  proposedRegularHours: number | null;
  proposedOvertimeHours: number;
  proposedSundayHours: number;
  proposedHolidayHours: number;
  leaveHours: number;
  unpaidHours: number;
  attendanceClassification: AttendanceClassification | null;
  status: DailyResultStatus;
  exceptionKinds: DayExceptionKind[];
  calculationFingerprint: string;
}
```

Define optional `CalculateDailyResultInput.approvedLeave` as `{ classification: 'approved_leave' | 'sick_leave'; hours: number } | null` and normalize omission to null. Use minute arithmetic, not floating timestamp subtraction scattered through UI code. Clean exact schedule auto-approves. Approved leave without a punch auto-approves the supplied leave category/hours. Any late/early pair returns `awaiting_supervisor` with proposed ordinary hours left `null`, because the approved policy forbids automatic deduction. Genuine outside-schedule minutes become proposed overtime. Missing clock-out returns the fixed fallback cap and `awaiting_worker`. A missing scheduled clock-in without approved leave returns `absence_review`; a missing Sunday punch returns a zero, non-blocking result. Holiday work populates only proposed holiday hours and waits for supervisor.

- [ ] **Step 4: Add the complete rule matrix**

Add tests for Saturday 08:00–13:00, missing Saturday/Sunday caps, early clock-in, late clock-out, late arrival, early departure, public holiday, invalid negative duration, SAST date handling and deterministic fingerprints.

Run: `npx vitest run src/services/attendance/policy/__tests__/calculateDailyResult.test.ts`

Expected: PASS with every approved policy branch asserted.

- [ ] **Step 5: Commit the policy engine**

```bash
git add src/services/attendance/policy
git commit -m "feat(attendance): calculate fixed schedule results"
```

### Task 3: Persist policy results and idempotent day exceptions

**Files:**
- Create: `src/services/attendance/policy/projectionRepository.ts`
- Create: `src/services/attendance/policy/__tests__/projectionRepository.test.ts`
- Create: `src/services/attendance/policy/jsonPayloadValidation.ts`
- Create: `src/services/attendance/policy/__tests__/jsonPayloadValidation.test.ts`
- Modify: `src/services/attendance/reconcileQueries.ts`
- Test: `src/services/attendance/__tests__/reconcileSql.integration.test.ts`

**Interfaces:**
- Consumes: `CalculatedDailyResult` from Task 2, `TxnClient` from `@/lib/db-pool`.
- Produces: `loadEffectivePolicy(workDate)`, `upsertDailyProjectionTxn(tx, args)`, `syncDayExceptionsTxn(tx, args)`, `loadExpectedAttendanceDays(fromDate, toDate)`.

- [ ] **Step 1: Write failing repository tests**

Create focused `jsonPayloadValidation` tests that accept a JSON value whose
serialized UTF-8 representation is at or below 1,048,576 bytes and reject one
above 1,048,576 bytes before SQL execution. The test for the rejected value
must prove the transaction client has no SQL calls.

```ts
it('uses worker/date/kind as stable exception identity', async () => {
  await syncDayExceptionsTxn(fakeTx, {
    staffId: STAFF_ID,
    entryId: ENTRY_ID,
    result: missingClockOutResult,
  });
  expect(fakeTx.calls.join('\n')).toContain(
    'attendance:2026-08-03:missing_clock_out'
  );
  expect(fakeTx.calls.join('\n')).toContain('ON CONFLICT (idempotency_key)');
});

it('increments a changed result version but preserves an identical result', async () => {
  expect(await upsertDailyProjectionTxn(fakeTx, changedArgs)).toMatchObject({ resultVersion: 2 });
  expect(await upsertDailyProjectionTxn(fakeTx, identicalArgs)).toMatchObject({ resultVersion: 1 });
});
```

- [ ] **Step 2: Run the repository tests and confirm failure**

Run: `npx vitest run src/services/attendance/policy/__tests__/projectionRepository.test.ts`

Expected: FAIL because the repository functions do not exist.

- [ ] **Step 3: Implement transaction-safe persistence**

```ts
export async function persistCalculatedDay(args: {
  staffId: string;
  entryId: string | null;
  policyId: string;
  result: CalculatedDailyResult;
}): Promise<{ resultVersion: number; exceptionIds: string[] }> {
  return transaction(async (tx) => {
    const projection = await upsertDailyProjectionTxn(tx, args);
    const exceptionIds = await syncDayExceptionsTxn(tx, {
      staffId: args.staffId,
      entryId: args.entryId,
      resultVersion: projection.resultVersion,
      result: args.result,
    });
    return { resultVersion: projection.resultVersion, exceptionIds };
  });
}
```

The upsert compares `calculation_fingerprint`: identical input updates only `computed_at`; changed input increments `result_version`. `syncDayExceptionsTxn` inserts/refreshes current kinds and cancels no-longer-applicable unresolved kinds in the same transaction. Use explicit SQL branches for nullable entry IDs; do not interpolate conditional SQL through the Neon shim.

Implement `jsonPayloadValidation` by serializing each value with `JSON.stringify`, measuring it with `Buffer.byteLength(serialized, 'utf8')`, and rejecting payloads above 1,048,576 bytes. Every JSONB value written by attendance policy/workflow services must be validated immediately before SQL execution. Task 3's `projectionRepository` must call this validator immediately before each of its JSONB writes; later policy/workflow writers must use the same module.

- [ ] **Step 4: Add chronological evidence and expected-day queries**

`loadExpectedAttendanceDays` returns active staff/date pairs for Monday–Saturday together with `public_holidays` context. There is no approved-leave source table in the current repository, so Phase 1 obtains approved/sick leave through the supervisor classification workflow in Task 7; it must not invent an automatic leave join. Every projected `DATE` is rendered with `to_char(..., 'YYYY-MM-DD')`.

Run: `npx vitest run src/services/attendance/policy/__tests__/projectionRepository.test.ts src/services/attendance/__tests__/reconcileSql.integration.test.ts`

Expected: PASS; integration suite must assert chronological ordering and explicit SAST date strings.

- [ ] **Step 5: Commit persistence**

```bash
git add src/services/attendance/policy/projectionRepository.ts src/services/attendance/policy/__tests__/projectionRepository.test.ts src/services/attendance/reconcileQueries.ts src/services/attendance/__tests__/reconcileSql.integration.test.ts
git commit -m "feat(attendance): persist policy daily results"
```

### Task 4: Make reconciliation schedule-aware and auditable

**Files:**
- Modify: `src/services/attendance/reconcile.ts`
- Modify: `src/services/attendance/reconcileQueries.ts`
- Modify: `src/services/attendance/reconcileWriters.ts`
- Modify: `scripts/cron/attendance-reconcile.ts`
- Modify: `src/services/attendance/__tests__/reconcile.test.ts`
- Modify: `src/services/attendance/__tests__/reconcileSql.integration.test.ts`

**Interfaces:**
- Consumes: `calculateDailyResult`, `persistCalculatedDay`, effective policy and expected attendance days.
- Produces: a `ReconcileReport` that counts system closures, projected days, missing-clock exceptions, absence exceptions, unchanged results and failed staff/date keys.

- [ ] **Step 1: Write failing reconcile tests for the approved caps and exception atomicity**

```ts
it('reconciles an old weekday open entry to an 8h awaiting-worker result', async () => {
  const report = await reconcile({ fromDate: '2026-08-03', toDate: '2026-08-03' });
  expect(report.systemClosed).toBe(1);
  expect(report.missingClockOutExceptions).toBe(1);
  expect(persistCalculatedDay).toHaveBeenCalledWith(expect.objectContaining({
    result: expect.objectContaining({
      status: 'awaiting_worker',
      proposedRegularHours: 8,
    }),
  }));
});

it('does not report successful persistence when exception insert fails', async () => {
  vi.mocked(persistCalculatedDay).mockRejectedValueOnce(new Error('exception write failed'));
  const report = await reconcile({ fromDate: '2026-08-03', toDate: '2026-08-03' });
  expect(report.failedDayKeys).toEqual([`${STAFF_ID}:2026-08-03`]);
  expect(report.projectedDays).toBe(0);
});
```

- [ ] **Step 2: Run the focused test and verify old behaviour fails**

Run: `npx vitest run src/services/attendance/__tests__/reconcile.test.ts`

Expected: FAIL because reconciliation still uses the generic 16-hour/9-hour path and old report fields.

- [ ] **Step 3: Replace duration configuration with policy-driven reconciliation**

Remove `autoCloseAfterHrs` and `autoCloseCapHrs` from the public options. Query stale sessions by prior work date and effective schedule, mark them `auto_closed` with system provenance while leaving `client_occurred_at_out` and selfie-out evidence null, then calculate the provisional fallback through Task 2.

Process existing entries and expected no-entry days through one `reconcileDay(staffId, workDate)` path. Preserve chronological weekly processing for legacy BCEA fields during shadow mode. A day is counted successful only after projection and exception transaction readback succeeds. Insert `attendance_reconciliation_runs` as `running`, then finish it as `succeeded`, `partial` or `failed` with counts and failed day keys; HR freshness reads this persisted run rather than process logs.

- [ ] **Step 4: Update cron output and idempotency tests**

```ts
export interface ReconcileReport {
  scannedFrom: string;
  scannedTo: string;
  systemClosed: number;
  projectedDays: number;
  unchangedDays: number;
  missingClockOutExceptions: number;
  missingClockInExceptions: number;
  failedDayKeys: string[];
  startedAt: string;
  finishedAt: string;
}
```

Run reconciliation twice in the test and assert the second run creates zero additional day exceptions and retains the same result version/fingerprint.

Run: `npx vitest run src/services/attendance/__tests__/reconcile.test.ts src/services/attendance/__tests__/reconcileSql.integration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit reconciliation**

```bash
git add src/services/attendance/reconcile.ts src/services/attendance/reconcileQueries.ts src/services/attendance/reconcileWriters.ts scripts/cron/attendance-reconcile.ts src/services/attendance/__tests__/reconcile.test.ts src/services/attendance/__tests__/reconcileSql.integration.test.ts
git commit -m "feat(attendance): reconcile schedule-aware exceptions"
```

### Task 5: Enforce the worker correction gate without blocking the new shift

**Files:**
- Create: `src/modules/attendance/workflow/requiredActionQueries.ts`
- Create: `src/modules/attendance/workflow/__tests__/requiredActionQueries.test.ts`
- Create: `src/modules/attendance/portal/clockInCommand.ts`
- Modify: `pages/api/my/attendance/clock-in.ts`
- Modify: `pages/api/my/attendance/current.ts`
- Modify: `pages/api/my/attendance-corrections.ts`
- Modify: `pages/api/my/hub-summary.ts`
- Modify: `src/modules/attendance/__tests__/api/my-clock-in.test.ts`
- Modify: `src/modules/attendance/__tests__/api/my-attendance-corrections.test.ts`
- Modify: `src/modules/attendance/__tests__/api/my-hub-summary.test.ts`
- Create: `src/modules/attendance/__tests__/api/my-attendance-current.test.ts`

**Interfaces:**
- Consumes: unresolved `attendance_day_exceptions` and existing `attendance_adjustments`.
- Produces: `findRequiredAttendanceAction(staffId, today): Promise<RequiredAttendanceAction | null>` and `submitMissingClockOutCorrection(args): Promise<SubmittedCorrection>`.

- [ ] **Step 1: Write failing API tests for the gate**

```ts
it('returns prior_correction_required before creating a new clock-in', async () => {
  vi.mocked(findRequiredAttendanceAction).mockResolvedValue({
    exceptionId: EXCEPTION_ID,
    entryId: ENTRY_ID,
    workDate: '2026-08-03',
    kind: 'missing_clock_out',
    provisionalPaidHours: 8,
    clockInAt: '2026-08-03T06:00:00.000Z',
  });
  await handler(req, res);
  expect(res.statusCode).toBe(409);
  expect(json(res).error.details).toMatchObject({
    reason: 'prior_correction_required',
    exceptionId: EXCEPTION_ID,
  });
  expect(insertClockIn).not.toHaveBeenCalled();
});

it('allows clock-in after correction submission while review is pending', async () => {
  vi.mocked(findRequiredAttendanceAction).mockResolvedValue(null);
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(insertClockIn).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run API tests and verify failure**

Run: `npx vitest run src/modules/attendance/__tests__/api/my-clock-in.test.ts src/modules/attendance/__tests__/api/my-attendance-corrections.test.ts`

Expected: FAIL because prior-day day exceptions are not checked or advanced.

- [ ] **Step 3: Implement required-action reads and atomic correction submission**

```ts
export interface RequiredAttendanceAction {
  exceptionId: string;
  entryId: string;
  workDate: string;
  kind: 'missing_clock_out';
  provisionalPaidHours: number;
  clockInAt: string;
}

export async function submitMissingClockOutCorrection(args: {
  staffId: string;
  exceptionId: string;
  adjustedClockOutAt: Date;
  reason: string;
}): Promise<{ adjustmentId: string; exceptionStatus: 'awaiting_supervisor' }>;
```

The transaction must prove exception ownership, status `awaiting_worker`, entry link and unlocked week; insert one `forgot_clock_out` adjustment; advance the exception to `awaiting_supervisor`; append a decision event; and return both IDs. A repeated identical submission returns the existing pending adjustment; a different second submission returns `409`.

Extract the existing clock-in orchestration into `executeClockInCommand` in `clockInCommand.ts`, leaving `clock-in.ts` as an authenticated validation/response adapter below 300 lines. Insert the gate before selfie upload so the rejected request creates neither a file nor a clock entry. Hub summary exposes the same required action so the UI does not rely on discovering it from a failed clock-in. Extend `current.ts` to return the effective schedule, current result status, recorded elapsed hours and scheduled paid hours so the worker UI does not calculate them.

- [ ] **Step 4: Add negative ownership, lock and retry tests**

Assert foreign exception IDs return IDOR-safe `404`, locked weeks return `period_locked`, identical retries do not duplicate adjustments, and failed transactions do not advance the day exception.

Run: `npx vitest run src/modules/attendance/workflow/__tests__/requiredActionQueries.test.ts src/modules/attendance/__tests__/api/my-clock-in.test.ts src/modules/attendance/__tests__/api/my-attendance-corrections.test.ts src/modules/attendance/__tests__/api/my-hub-summary.test.ts src/modules/attendance/__tests__/api/my-attendance-current.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the worker gate**

```bash
git add src/modules/attendance/workflow/requiredActionQueries.ts src/modules/attendance/workflow/__tests__/requiredActionQueries.test.ts src/modules/attendance/portal/clockInCommand.ts pages/api/my/attendance/clock-in.ts pages/api/my/attendance/current.ts pages/api/my/attendance-corrections.ts pages/api/my/hub-summary.ts src/modules/attendance/__tests__/api/my-clock-in.test.ts src/modules/attendance/__tests__/api/my-attendance-current.test.ts src/modules/attendance/__tests__/api/my-attendance-corrections.test.ts src/modules/attendance/__tests__/api/my-hub-summary.test.ts
git commit -m "feat(attendance): require missing clock correction"
```

### Task 6: Add the complete worker `/my` walkthrough

**Files:**
- Create: `src/modules/attendance/portal/client/AttendanceRequiredActionCard.tsx`
- Create: `src/modules/attendance/portal/client/__tests__/AttendanceRequiredActionCard.test.tsx`
- Create: `src/modules/attendance/portal/client/useMyHubData.ts`
- Modify: `src/modules/attendance/portal/client/api.ts`
- Modify: `src/modules/attendance/portal/client/MyHub.tsx`
- Modify: `pages/my/attendance.tsx`
- Modify: `pages/my/attendance/clock.tsx`
- Modify: `pages/my/attendance/corrections/new.tsx`
- Create: `tests/pages/my-attendance-required-action.test.tsx`

**Interfaces:**
- Consumes: `HubSummaryResponse.requiredAttendanceAction` and the existing correction POST route.
- Produces: action-required card, correction form state and confirmed unlock message used by the Playwright journey in Task 12.

- [ ] **Step 1: Write the failing component test**

```tsx
render(
  <AttendanceRequiredActionCard
    action={{
      exceptionId: 'ex-1', entryId: 'en-1', workDate: '2026-08-03',
      kind: 'missing_clock_out', provisionalPaidHours: 8,
      clockInAt: '2026-08-03T06:00:00.000Z',
    }}
    onCorrect={onCorrect}
  />
);
expect(screen.getByRole('heading', { name: /previous clock-out missing/i })).toBeVisible();
expect(screen.getByText(/provisional cap: 8 hours/i)).toBeVisible();
await user.click(screen.getByRole('button', { name: /submit clock-out correction/i }));
expect(onCorrect).toHaveBeenCalledWith('ex-1');
```

- [ ] **Step 2: Run the UI tests and verify failure**

Run: `npx vitest run src/modules/attendance/portal/client/__tests__/AttendanceRequiredActionCard.test.tsx tests/pages/my-attendance-required-action.test.tsx`

Expected: FAIL because the card and typed response do not exist.

- [ ] **Step 3: Implement typed worker states**

Extend `HubSummaryResponse`:

```ts
requiredAttendanceAction: {
  exceptionId: string;
  entryId: string;
  workDate: string;
  kind: 'missing_clock_out';
  provisionalPaidHours: number;
  clockInAt: string;
} | null;
```

Move `MyHub` fetch/effect state into `useMyHubData.ts` so the modified component is below 200 lines. Render the card before the normal clock tile in `MyHub`. In `/my/attendance`, replace the clock action with a link to:

```text
/my/attendance/corrections/new?entry_id=<entry>&exception_id=<exception>
```

The clock page displays the server-provided schedule before clock-in, active clock time while working, and recorded elapsed versus scheduled paid time after clock-out. A clean weekday explicitly shows `08:00–17:00`, `1h unpaid lunch` and `8h scheduled paid`; Saturday shows `08:00–13:00` and `5h scheduled paid`.

The correction form preselects `forgot_clock_out`, requires a clock-out timestamp and reason, and displays **Today's clock-in is now enabled; supervisor review is pending** only after the POST returns success. A network/API failure keeps the action blocked and preserves entered values.

- [ ] **Step 4: Test mobile states and API-confirmed transitions**

Add tests for 8-hour weekday and 5-hour Saturday/Sunday copy, loading, network error, successful submission, and the absence of the normal clock button until success.

Run: `npx vitest run src/modules/attendance/portal/client/__tests__/AttendanceRequiredActionCard.test.tsx tests/pages/my-attendance-required-action.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the worker UI**

```bash
git add src/modules/attendance/portal/client/AttendanceRequiredActionCard.tsx src/modules/attendance/portal/client/__tests__/AttendanceRequiredActionCard.test.tsx src/modules/attendance/portal/client/useMyHubData.ts src/modules/attendance/portal/client/api.ts src/modules/attendance/portal/client/MyHub.tsx pages/my/attendance.tsx pages/my/attendance/clock.tsx pages/my/attendance/corrections/new.tsx tests/pages/my-attendance-required-action.test.tsx
git commit -m "feat(attendance): add worker correction walkthrough"
```

### Task 7: Implement the scoped supervisor day-exception workflow

**Files:**
- Create: `src/modules/attendance/workflow/types.ts`
- Create: `src/modules/attendance/workflow/dayExceptionQueries.ts`
- Create: `src/modules/attendance/workflow/__tests__/dayExceptionQueries.test.ts`
- Create: `pages/api/staff/attendance-day-exceptions.ts`
- Create: `pages/api/staff/attendance-day-exceptions-review.ts`
- Create: `src/modules/attendance/__tests__/api/staff-attendance-day-exceptions.test.ts`
- Create: `src/modules/attendance/__tests__/api/staff-attendance-day-exceptions-review.test.ts`

**Interfaces:**
- Consumes: day exceptions, adjustments, daily result version, `resolveScope`/`staffIdsSupervisedBy`, lock lookup and audited selfie route.
- Produces: `listDayExceptions(args): Promise<DayExceptionListResult>` and `decideDayException(args): Promise<DayExceptionDecisionResult>`.

- [ ] **Step 1: Write failing scope and state-transition tests**

```ts
it('returns only workers in supervisor scope', async () => {
  vi.mocked(staffIdsSupervisedBy).mockResolvedValue([STAFF_A]);
  const result = await listDayExceptions({
    user: SUPERVISOR,
    status: 'open',
    limit: 100,
  });
  expect(result.items.every((item) => item.staffId === STAFF_A)).toBe(true);
});

it('rejects a stale result version without writing a decision', async () => {
  await expect(decideDayException({
    exceptionId: EXCEPTION_ID,
    expectedResultVersion: 3,
    action: 'approve',
    approvedHours: { regular: 8, overtime: 0, sunday: 0, holiday: 0, leave: 0, unpaid: 0 },
    reason: 'Confirmed against site close record',
    actor: SUPERVISOR,
  })).rejects.toMatchObject({ code: 'result_stale' });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run src/modules/attendance/workflow/__tests__/dayExceptionQueries.test.ts src/modules/attendance/__tests__/api/staff-attendance-day-exceptions.test.ts src/modules/attendance/__tests__/api/staff-attendance-day-exceptions-review.test.ts`

Expected: FAIL because the queue and review endpoints do not exist.

- [ ] **Step 3: Implement queue and decision types**

```ts
import type { AttendanceClassification } from '@/services/attendance/policy/types';
export type { AttendanceClassification } from '@/services/attendance/policy/types';

export interface ApprovedHours {
  regular: number;
  overtime: number;
  sunday: number;
  holiday: number;
  leave: number;
  unpaid: number;
}

export interface DayExceptionDecisionInput {
  exceptionId: string;
  expectedResultVersion: number;
  action: 'approve' | 'return' | 'classify';
  classification?: AttendanceClassification;
  approvedHours?: ApprovedHours;
  reason: string;
  actor: AuthUser;
}
```

The list query returns clock evidence, adjustment, result/proposed hours, site/crew, evidence availability and queue owner. The decision transaction rechecks permission, staff scope, exception state, active lock and result version; writes approved hours/classification; resolves or returns the exception; appends `attendance_decision_events`; and read-backs the new result. Do not expose selfie URLs directly.

- [ ] **Step 4: Add every classification and negative-authority test**

Test all five classifications, Sunday approval, overtime approval, returned correction, foreign worker `404`, locked week `409`, double decision `409`, stale version `409`, missing reason `400` and an approved total outside physical bounds `400`.

Run: `npx vitest run src/modules/attendance/workflow/__tests__/dayExceptionQueries.test.ts src/modules/attendance/__tests__/api/staff-attendance-day-exceptions.test.ts src/modules/attendance/__tests__/api/staff-attendance-day-exceptions-review.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the supervisor workflow**

```bash
git add src/modules/attendance/workflow/types.ts src/modules/attendance/workflow/dayExceptionQueries.ts src/modules/attendance/workflow/__tests__/dayExceptionQueries.test.ts pages/api/staff/attendance-day-exceptions.ts pages/api/staff/attendance-day-exceptions-review.ts src/modules/attendance/__tests__/api/staff-attendance-day-exceptions.test.ts src/modules/attendance/__tests__/api/staff-attendance-day-exceptions-review.test.ts
git commit -m "feat(attendance): add supervisor exception workflow"
```

### Task 8: Replace the oversized corrections page with the supervisor action queue

**Files:**
- Create: `src/components/attendance/actions/ActionSummaryCards.tsx`
- Create: `src/components/attendance/actions/ActionQueue.tsx`
- Create: `src/components/attendance/actions/ActionDetailPanel.tsx`
- Create: `src/components/attendance/actions/DecisionForm.tsx`
- Create: `src/components/attendance/actions/useAttendanceActions.ts`
- Create: `src/components/attendance/actions/__tests__/DecisionForm.test.tsx`
- Modify: `pages/staff/attendance/corrections.tsx`
- Modify: `src/components/attendance/attendanceNavConfig.ts`
- Create: `tests/pages/staff-attendance-actions.test.tsx`

**Interfaces:**
- Consumes: Task 7 GET/POST APIs.
- Produces: the desktop supervisor journey and stable locators used by Task 12 Playwright tests.

- [ ] **Step 1: Write the failing decision-form tests**

```tsx
render(<DecisionForm item={sundayWorkItem} onSubmit={onSubmit} busy={false} />);
expect(screen.getByText(/sunday work/i)).toBeVisible();
expect(screen.getByLabelText(/approved sunday hours/i)).toHaveValue(5);
await user.type(screen.getByLabelText(/decision reason/i), 'Approved planned repair crew');
await user.click(screen.getByRole('button', { name: /approve for payroll/i }));
expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
  action: 'approve',
  approvedHours: expect.objectContaining({ sunday: 5 }),
}));
```

- [ ] **Step 2: Run page/component tests and verify failure**

Run: `npx vitest run src/components/attendance/actions/__tests__/DecisionForm.test.tsx tests/pages/staff-attendance-actions.test.tsx`

Expected: FAIL because the focused action components do not exist.

- [ ] **Step 3: Build focused components and a thin page shell**

Change the visible nav label from **Corrections** to **Actions** while retaining `/staff/attendance/corrections` for stable links. Keep the page under 200 lines and each component under 200 lines.

The queue displays present/flagged/open/missing-clock counts, prioritises missing punch and payroll blockers, and preserves filters in the URL. The detail panel shows proposed/approved hours and evidence status. Unavailable evidence reads **Unavailable** with last-check context; it never renders a green match.

The decision form supplies separate approve, return and absence-classification paths. It disables duplicate submission, preserves reason text after a `409`, reloads the current item and shows the exact stale-state message.

- [ ] **Step 4: Test empty, error, scoped and API-confirmation states**

Add tests for no workers in scope, no exceptions, evidence unavailable, loading, API failure, stale version, successful readback and the absence of optimistic success before POST completion.

Run: `npx vitest run src/components/attendance/actions/__tests__/DecisionForm.test.tsx tests/pages/staff-attendance-actions.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the supervisor UI**

```bash
git add src/components/attendance/actions pages/staff/attendance/corrections.tsx src/components/attendance/attendanceNavConfig.ts tests/pages/staff-attendance-actions.test.tsx
git commit -m "feat(attendance): add supervisor action queue"
```

### Task 9: Add HR readiness and immutable lock history

**Files:**
- Create: `src/modules/attendance/workflow/periodQueries.ts`
- Create: `src/modules/attendance/workflow/__tests__/periodQueries.test.ts`
- Create: `pages/api/staff/attendance-period-readiness.ts`
- Create: `src/modules/attendance/__tests__/api/staff-attendance-period-readiness.test.ts`
- Modify: `src/modules/attendance/corrections/lockQueries.ts`
- Modify: `pages/api/staff/attendance-weekly-locks.ts`
- Modify: `src/modules/attendance/__tests__/api/staff-attendance-weekly-locks.test.ts`

**Interfaces:**
- Consumes: approved daily results, unresolved day exceptions, reconciliation health and existing active weekly lock.
- Produces: `getPeriodReadiness(weekStartDate)`, `lockReadyWeek(args)` and `unlockWeekWithHistory(args)`.

- [ ] **Step 1: Write failing readiness and lock tests**

```ts
it('blocks a week containing unresolved worker and supervisor actions', async () => {
  const result = await getPeriodReadiness('2026-08-03');
  expect(result).toMatchObject({
    readyToLock: false,
    blockerCount: 2,
  });
  expect(result.blockers.map((b) => b.kind)).toEqual([
    'awaiting_worker', 'awaiting_supervisor',
  ]);
});

it('writes active lock, history and daily locked version atomically', async () => {
  const locked = await lockReadyWeek({
    weekStartDate: '2026-08-03',
    actorUserId: HR_USER_ID,
    reason: 'HR approved parallel payroll review',
  });
  expect(locked).toMatchObject({ weekStartDate: '2026-08-03', version: 1 });
  expect(transactionLog).toEqual(expect.arrayContaining([
    'attendance_weekly_locks',
    'attendance_weekly_lock_history',
    'attendance_daily_summaries',
    'attendance_decision_events',
  ]));
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run src/modules/attendance/workflow/__tests__/periodQueries.test.ts src/modules/attendance/__tests__/api/staff-attendance-period-readiness.test.ts src/modules/attendance/__tests__/api/staff-attendance-weekly-locks.test.ts`

Expected: FAIL because readiness and immutable history are absent.

- [ ] **Step 3: Implement the period readiness contract**

```ts
export interface PeriodReadiness {
  weekStartDate: string;
  weekEndDate: string;
  activeStaffCount: number;
  expectedDayCount: number;
  approvedDayCount: number;
  blockerCount: number;
  unapprovedOvertimeHours: number;
  unapprovedSundayHours: number;
  reconciliationLastSucceededAt: string | null;
  reconciliationFresh: boolean;
  readyToLock: boolean;
  blockers: Array<{
    staffId: string;
    workDate: string;
    kind: string;
    owner: 'worker' | 'supervisor' | 'hr';
    actionUrl: string;
  }>;
}
```

`readyToLock` is true only when reconciliation is fresh, every expected day exists, every daily result is `approved`, and there are zero unresolved blocking exceptions. Perform lock, lock-history insert, daily `locked` transition and decision event in one transaction using `SELECT ... FOR UPDATE`.

Unlock requires permission, at least ten reason characters and an active lock. It appends history/action events and returns daily results to `approved` without deleting prior versions. Re-lock increments the lock version.

- [ ] **Step 4: Add permission, freshness, concurrency and readback tests**

Assert invalid Monday, stale reconcile, incomplete expected day, unapproved Sunday/OT, concurrent lock, unauthorised unlock, short reason, unlock/re-lock version 2 and `to_char` date output.

Run: `npx vitest run src/modules/attendance/workflow/__tests__/periodQueries.test.ts src/modules/attendance/__tests__/api/staff-attendance-period-readiness.test.ts src/modules/attendance/__tests__/api/staff-attendance-weekly-locks.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit HR readiness backend**

```bash
git add src/modules/attendance/workflow/periodQueries.ts src/modules/attendance/workflow/__tests__/periodQueries.test.ts pages/api/staff/attendance-period-readiness.ts src/modules/attendance/__tests__/api/staff-attendance-period-readiness.test.ts src/modules/attendance/corrections/lockQueries.ts pages/api/staff/attendance-weekly-locks.ts src/modules/attendance/__tests__/api/staff-attendance-weekly-locks.test.ts
git commit -m "feat(attendance): gate HR weekly locks on readiness"
```

### Task 10: Build the HR readiness and lock walkthrough

**Files:**
- Create: `src/components/attendance/readiness/ReadinessSummary.tsx`
- Create: `src/components/attendance/readiness/ReadinessBlockers.tsx`
- Create: `src/components/attendance/readiness/PeriodLockControls.tsx`
- Create: `src/components/attendance/readiness/usePeriodReadiness.ts`
- Create: `src/components/attendance/readiness/__tests__/PeriodLockControls.test.tsx`
- Modify: `pages/staff/attendance/locks.tsx`
- Modify: `pages/staff/attendance/week.tsx`
- Create: `tests/pages/staff-attendance-readiness.test.tsx`

**Interfaces:**
- Consumes: Task 9 readiness and weekly-lock APIs.
- Produces: readiness cards, exact blocking actions, audited lock/unlock controls and payroll-preview navigation.

- [ ] **Step 1: Write the failing lock-control test**

```tsx
render(
  <PeriodLockControls
    readiness={{ ...blockedReadiness, readyToLock: false, blockerCount: 3 }}
    activeLock={null}
    onLock={onLock}
    onUnlock={onUnlock}
    busy={false}
  />
);
expect(screen.getByRole('button', { name: /lock approved week/i })).toBeDisabled();
expect(screen.getByText(/resolve 3 blocking items/i)).toBeVisible();
```

- [ ] **Step 2: Run component/page tests and verify failure**

Run: `npx vitest run src/components/attendance/readiness/__tests__/PeriodLockControls.test.tsx tests/pages/staff-attendance-readiness.test.tsx`

Expected: FAIL because readiness components do not exist.

- [ ] **Step 3: Refactor HR pages into focused components**

Keep `/staff/attendance/locks` as the lock/history route. Replace manual blind lock controls with readiness-gated controls for the selected ISO week. Show exact expected/approved/blocker counts, unapproved Sunday/OT, reconcile freshness and links to the responsible action.

Keep bulk lock unavailable unless every selected week independently passes readiness. `/staff/attendance/week` shows approved/locked hour categories and links to the export action only for a locked version.

- [ ] **Step 4: Verify UI authority and failure states**

Test no permission, stale reconciliation, unresolved blockers, clean lock, audited unlock prompt, concurrent `409`, empty week and API-confirmed state reload. Each modified page must be below 200 component lines after extraction.

Run: `npx vitest run src/components/attendance/readiness/__tests__/PeriodLockControls.test.tsx tests/pages/staff-attendance-readiness.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit HR UI**

```bash
git add src/components/attendance/readiness pages/staff/attendance/locks.tsx pages/staff/attendance/week.tsx tests/pages/staff-attendance-readiness.test.tsx
git commit -m "feat(attendance): add HR readiness walkthrough"
```

### Task 11: Make payroll export locked, deterministic and hours-only

**Files:**
- Create: `src/services/attendance/payroll/types.ts`
- Create: `src/services/attendance/payroll/query.ts`
- Create: `src/services/attendance/payroll/serialize.ts`
- Create: `src/services/attendance/payroll/storage.ts`
- Create: `src/services/attendance/payroll/exportService.ts`
- Create: `src/services/attendance/payroll/__tests__/exportService.test.ts`
- Modify: `pages/api/staff/attendance-export.ts`
- Modify: `src/modules/attendance/__tests__/api/staff-attendance-export.test.ts`
- Modify: `tests/api/staff/attendance-export-columns.test.ts`

**Interfaces:**
- Consumes: active lock version and locked approved daily-result columns.
- Produces: `preparePayrollExport(args): Promise<PreparedPayrollExport>` and stable CSV/XLSX bytes with a persisted SHA-256 checksum.

- [ ] **Step 1: Write the failing deterministic-export tests**

```ts
it('refuses an unlocked week', async () => {
  await expect(preparePayrollExport({
    weekStartDate: '2026-08-03', format: 'csv', actorUserId: HR_USER_ID,
  })).rejects.toMatchObject({ code: 'period_locked' });
});

it('repeats identical bytes and checksum for the same locked version', async () => {
  const first = await preparePayrollExport(args);
  const second = await preparePayrollExport(args);
  expect(second.bytes.equals(first.bytes)).toBe(true);
  expect(second.sha256).toBe(first.sha256);
  expect(second.exportId).toBe(first.exportId);
});
```

- [ ] **Step 2: Run export tests and verify current behaviour fails**

Run: `npx vitest run src/services/attendance/payroll/__tests__/exportService.test.ts src/modules/attendance/__tests__/api/staff-attendance-export.test.ts tests/api/staff/attendance-export-columns.test.ts`

Expected: FAIL because the current export auto-locks, includes wage columns and has no version/checksum record.

- [ ] **Step 3: Define the exact payroll-ready columns and service**

```ts
export const PAYROLL_EXPORT_COLUMNS = [
  'staff_id', 'employee_id', 'full_name', 'work_date',
  'ordinary_hours', 'overtime_hours', 'sunday_hours',
  'public_holiday_hours', 'approved_leave_hours', 'sick_leave_hours',
  'unpaid_hours', 'project_id', 'site_id', 'lock_version', 'audit_reference',
] as const;

export interface PreparedPayrollExport {
  exportId: string;
  format: 'csv' | 'xlsx';
  lockVersion: number;
  rowCount: number;
  totals: Record<string, string>;
  sha256: string;
  bytes: Buffer;
}
```

Query only daily results with the active lock version and `result_status='locked'`. Map attendance classification into separate approved-leave, sick-leave and unpaid columns. Remove wage/rate values from this new export. Set deterministic XLSX properties from the immutable lock timestamp and fixed worksheet order.

`storage.ts` wraps `vfStorage` from `@/services/vfStorageAdapter` behind this injectable interface:

```ts
export interface PayrollExportStorage {
  upload(bytes: Buffer, filename: string): Promise<{ path: string; filename: string }>;
  remove(filename: string): Promise<boolean>;
}
```

Upload to VF Storage type `attendance`, category `payroll-exports`, then persist the returned path and SHA-256 in `attendance_payroll_exports` before streaming. If metadata persistence fails after upload, delete the orphan. If upload fails, mark the export row `failed` and stream no bytes.

The existing route remains the public URL but becomes a thin authenticated handler. `dry_run=true` returns the exact row/totals preview without writing a lock or export.

- [ ] **Step 4: Test totals, column order, failed generation and re-export**

Assert unapproved values never appear, preview equals export totals, empty locked week is rejected, column order is exact, CSV escaping is correct, XLSX sheet/cells match CSV, failed storage publishes no success, and format-specific retries are deterministic.

Run: `npx vitest run src/services/attendance/payroll/__tests__/exportService.test.ts src/modules/attendance/__tests__/api/staff-attendance-export.test.ts tests/api/staff/attendance-export-columns.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit payroll export**

```bash
git add src/services/attendance/payroll pages/api/staff/attendance-export.ts src/modules/attendance/__tests__/api/staff-attendance-export.test.ts tests/api/staff/attendance-export-columns.test.ts
git commit -m "feat(attendance): export locked payroll hours"
```

### Task 12: Add idempotent worker, supervisor and HR notifications

**Files:**
- Create: `src/modules/attendance/workflow/notificationService.ts`
- Create: `src/modules/attendance/workflow/__tests__/notificationService.test.ts`
- Modify: `src/modules/notifications/constants/index.ts`
- Create: `scripts/cron/attendance-notifications.ts`
- Create: `scripts/cron-attendance-notifications.sh`
- Create: `scripts/__tests__/attendance-notifications.test.ts`

**Interfaces:**
- Consumes: open sessions, day exceptions, supervisor scope, readiness and unified `notify()`.
- Produces: `runAttendanceNotifications({ phase, now }): Promise<AttendanceNotificationReport>` for `morning`, `clockout`, `digest`, `weekly` phases.

**Carry-forward:** Morning correction notifications currently select only current,
unresolved `missing_clock_out` exceptions with an owned open entry. A
`missing_clock_in` exception has no supported raw-entry correction command or
worker submission contract yet, so it must not generate a dead-link notification.
Adding that notification requires a separately designed clock-in correction flow.

- [ ] **Step 1: Write failing notification idempotency tests**

```ts
it('claims one delivery key before calling the notification bus', async () => {
  await runAttendanceNotifications({ phase: 'clockout', now: new Date('2026-08-03T15:00:00Z') });
  await runAttendanceNotifications({ phase: 'clockout', now: new Date('2026-08-03T15:01:00Z') });
  expect(notify).toHaveBeenCalledTimes(1);
  expect(claimedKeys).toEqual([
    `attendance:clockout:${STAFF_ID}:2026-08-03`,
  ]);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run src/modules/attendance/workflow/__tests__/notificationService.test.ts scripts/__tests__/attendance-notifications.test.ts`

Expected: FAIL because attendance notification phases and delivery claims do not exist.

- [ ] **Step 3: Implement delivery claims and unified-notification events**

Add these event keys to all required notification constant maps and the Attendance group:

```ts
'attendance.clockout_due'
'attendance.correction_required'
'attendance.supervisor_digest'
'attendance.hr_readiness'
```

`claimAttendanceNotification` inserts `attendance_notification_dispatches.delivery_key` with `ON CONFLICT DO NOTHING`. Only the process that inserted the key calls:

```ts
notify({
  event_type: eventType,
  title,
  body,
  action_url: actionUrl,
  source_module: 'attendance',
  source_id: sourceId,
  recipient_user_ids: recipientUserIds,
}).catch(() => {});
```

Resolve recipients before calling the bus. Mark dispatch `accepted` after `notify()` is invoked and `failed` when recipient resolution fails. Notification state never mutates attendance state.

- [ ] **Step 4: Implement the guarded cron wrapper and phase tests**

The TypeScript script accepts only `--phase=morning|clockout|digest|weekly`, loads dotenv before the DB pool and emits run ID/counts/failures to stderr/stdout. The shell wrapper uses `flock`, reads deploy environment safely and never embeds a secret.

Documented intended schedules are 08:15 Monday–Saturday, 17:00 Monday–Friday, 13:00 Saturday, end-of-day digest, and weekly HR readiness. Scheduling the real cron remains an operations approval step.

Run: `npx vitest run src/modules/attendance/workflow/__tests__/notificationService.test.ts scripts/__tests__/attendance-notifications.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit notifications**

```bash
git add src/modules/attendance/workflow/notificationService.ts src/modules/attendance/workflow/__tests__/notificationService.test.ts src/modules/notifications/constants/index.ts scripts/cron/attendance-notifications.ts scripts/cron-attendance-notifications.sh scripts/__tests__/attendance-notifications.test.ts
git commit -m "feat(attendance): automate attendance notifications"
```

### Task 13: Add readiness, exception and evidence-quality reports

**Files:**
- Create: `src/services/attendance/reports/exceptionAgeing.ts`
- Create: `src/services/attendance/reports/payrollReadiness.ts`
- Create: `src/services/attendance/reports/evidenceQuality.ts`
- Create: `src/services/attendance/reports/__tests__/exceptionAgeing.test.ts`
- Create: `src/services/attendance/reports/__tests__/payrollReadiness.test.ts`
- Create: `src/services/attendance/reports/__tests__/evidenceQuality.test.ts`
- Modify: `src/services/attendance/reports/types.ts`
- Modify: `src/services/attendance/reports/runner.ts`
- Modify: `pages/staff/attendance/reports/index.tsx`

**Interfaces:**
- Consumes: scoped day exceptions, locked daily results, evidence/corroboration coverage and existing report runner.
- Produces: `exception-ageing`, `payroll-readiness`, `evidence-quality` report slugs with CSV/XLSX export through the existing report route.

- [ ] **Step 1: Write failing catalogue and scope tests**

```ts
it.each(['exception-ageing', 'payroll-readiness', 'evidence-quality'] as const)(
  'registers %s in catalogue and dispatcher',
  (slug) => {
    expect(ALL_REPORT_SLUGS).toContain(slug);
    expect(REPORT_CATALOGUE.find((item) => item.slug === slug)).toBeDefined();
  }
);

it('keeps evidence quality separate from payroll blockers', async () => {
  const result = await runEvidenceQuality(input);
  expect(result.columns).toContainEqual(expect.objectContaining({ key: 'coverage_status' }));
  expect(result.columns).not.toContainEqual(expect.objectContaining({ key: 'payroll_approved' }));
});
```

- [ ] **Step 2: Run report tests and verify failure**

Run: `npx vitest run src/services/attendance/reports/__tests__/catalogueWiring.test.ts src/services/attendance/reports/__tests__/exceptionAgeing.test.ts src/services/attendance/reports/__tests__/payrollReadiness.test.ts src/services/attendance/reports/__tests__/evidenceQuality.test.ts`

Expected: FAIL because the three slugs and modules do not exist.

- [ ] **Step 3: Implement scoped report modules**

`exception-ageing` returns worker, work date, kind, owner, status, age and action URL. `payroll-readiness` returns expected/approved/blocked days plus approved hour categories by worker/department. `evidence-quality` returns GPS/selfie/geofence/Cartrack available, unavailable and unreliable counts without a fraud or payroll verdict.

Use `ReportInput.scopedStaffIds`, the 50,000-row cap and the existing telemetry runner. Render `DATE` with `to_char`. Replace the misleading late-arrivals deferral copy on the report grid with the new policy-backed reports.

- [ ] **Step 4: Verify empty scope, totals and export parity**

Test no staff in scope, supervisor-scoped rows, organisation HR scope, unresolved-only ageing default, locked-version readiness totals and report-export column parity.

Run: `npx vitest run src/services/attendance/reports/__tests__`

Expected: PASS.

- [ ] **Step 5: Commit reports**

```bash
git add src/services/attendance/reports pages/staff/attendance/reports/index.tsx
git commit -m "feat(attendance): report workflow readiness"
```

### Task 14: Prove the full UI journeys and prepare controlled rollout

**Files:**
- Create: `tests/e2e/attendance-workforce-phase1.spec.ts`
- Create: `tests/e2e/fixtures/attendance-workforce.ts`
- Create: `scripts/audit/attendance-policy-shadow.ts`
- Create: `scripts/__tests__/attendance-policy-shadow.test.ts`
- Create: `docs/operations/attendance-workforce-phase1.md`
- Modify: `src/modules/attendance/AGENTS.md`
- Modify: `src/modules/attendance/.claude.md`

**Interfaces:**
- Consumes: all Tasks 1–13.
- Produces: Playwright screenshots/readback evidence, shadow variance output and an approval-gated operations runbook.

- [ ] **Step 1: Write the failing Playwright journey skeleton with real assertions**

```ts
test('missing clock-out correction unlocks work before supervisor approval', async ({ page, request }) => {
  await seedMissingClockOut(request, { paidCapHours: 8 });
  await loginMyPortal(page, WORKER);
  await expect(page.getByRole('heading', { name: /previous clock-out missing/i })).toBeVisible();
  await page.getByLabel(/claimed clock-out time/i).fill('2026-08-03T17:00');
  await page.getByLabel(/reason/i).fill('Forgot during site close and vehicle handover');
  await page.getByRole('button', { name: /submit correction/i }).click();
  await expect(page.getByText(/today's clock-in is now enabled/i)).toBeVisible();
  const state = await readAttendanceState(request, WORKER.staffId, '2026-08-03');
  expect(state).toMatchObject({
    resultStatus: 'awaiting_supervisor',
    adjustmentStatus: 'pending',
    proposedRegularHours: 8,
  });
});
```

- [ ] **Step 2: Run the E2E file and verify missing fixtures/features fail**

Run: `npm run test:e2e -- tests/e2e/attendance-workforce-phase1.spec.ts`

Expected: FAIL because the controlled fixture and complete journeys are not wired.

- [ ] **Step 3: Implement all approved browser journeys**

Cover normal weekday, missing-out correction/unlock, correction approve/return, all five absence classifications, Sunday approval, outside-schedule approval, HR blocker/lock/unlock, deterministic export, role/API denial, offline duplicate sync and degraded evidence.

Every journey must assert the UI, the API response and persisted database readback. Capture named mobile and desktop screenshots under Playwright output; inspect them for clipped controls, touch targets, hierarchy, empty/error states and premature success.

- [ ] **Step 4: Add shadow comparison and operations runbook**

The shadow command accepts `--from=YYYY-MM-DD --to=YYYY-MM-DD --format=json|csv`, reads legacy and policy projections, and emits worker/date deltas with reason codes. It performs no writes.

The runbook contains exact approval gates and commands for:

1. migration backup and approved DEV application;
2. real PostgreSQL probe;
3. shadow run and reconciliation sign-off;
4. pilot crew enablement and rollback flag;
5. cron installation after approval;
6. payroll export enablement after a clean parallel run;
7. DEV deployment through `bash scripts/deploy-local.sh dev`;
8. production deployment only after explicit approval and within the allowed window.

Update the canonical `src/modules/attendance/.claude.md`, then run `node scripts/mirror-agents-md.mjs` to regenerate `AGENTS.md`; never hand-edit the generated file.

- [ ] **Step 5: Run the full verification gate**

Run:

```bash
npx vitest run src/services/attendance src/modules/attendance tests/api/staff/attendance-export-columns.test.ts tests/pages/staff-attendance-actions.test.tsx tests/pages/staff-attendance-readiness.test.tsx
npm run test:e2e -- tests/e2e/attendance-workforce-phase1.spec.ts
npm run antihall
npm run claude-md:check
npm run ci:quick
git diff --check
```

Expected: every focused suite and gate passes. Also run the approved real PostgreSQL probe; if no approved test database is available, report database proof as blocked rather than substituting mocks.

- [ ] **Step 6: Commit verification and rollout documentation**

```bash
git add tests/e2e/attendance-workforce-phase1.spec.ts tests/e2e/fixtures/attendance-workforce.ts scripts/audit/attendance-policy-shadow.ts scripts/__tests__/attendance-policy-shadow.test.ts docs/operations/attendance-workforce-phase1.md src/modules/attendance/.claude.md src/modules/attendance/AGENTS.md
git commit -m "test(attendance): prove workforce phase 1 journeys"
```

### Task 15: Final review, pull request and DEV-only handoff

**Files:**
- Review: all files changed by Tasks 1–14
- Update if required: `docs/operations/attendance-workforce-phase1.md`

**Interfaces:**
- Consumes: complete verified implementation branch.
- Produces: reviewed draft pull request and an explicit list of unexecuted migration/deployment approvals.

- [ ] **Step 1: Rebase and rerun changed-file verification**

```bash
git fetch origin master
git rebase origin/master
npm run ci:quick
npm run antihall
git diff --check origin/master...HEAD
```

Expected: clean rebase and passing gates. Re-run focused/E2E tests affected by any conflict resolution.

- [ ] **Step 2: Perform a requirement-by-requirement review**

Check the implementation against every section of the approved specification. Record evidence for fixed hours, caps, correction gate, supervisor scope, HR lock, deterministic export, evidence degradation, UI screenshots and persisted readback in the PR body.

- [ ] **Step 3: Request code review before publication**

Use `superpowers:requesting-code-review`. Address confirmed findings with focused tests and commits. Do not waive a finding by describing intended behaviour without evidence.

- [ ] **Step 4: Push and create a draft pull request through the approved GitHub workflow**

```bash
gh auth status
git status --short
```

Then use the repository's `github:yeet` workflow so scope, commit set, branch push and draft PR creation are reviewed together. The PR must state that migrations 475/476, cron installation, DEV deployment, pilot enablement and production deployment have not occurred unless separately approved and verified.

- [ ] **Step 5: Stop at the operational approval boundary**

Do not apply migrations 475/476 to the shared database and do not deploy merely because the PR is open or merged. Ask Hein separately for the database/DEV pilot action, and later for every production deploy.

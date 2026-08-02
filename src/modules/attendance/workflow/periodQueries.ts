import { query, transaction, type TxnClient } from '@/lib/db-pool';
import { userHasPermission } from '@/lib/permissions';
import { acquireAttendanceWeekLock } from '@/modules/attendance/corrections/lockQueries';
import { serializeJsonPayload } from '@/services/attendance/policy/jsonPayloadValidation';
import { employmentEffectivePredicate } from '@/services/attendance/employmentUniverse';
import { blockersSql, metricsSql } from './periodReadinessSql';
import { buildPayrollLockSnapshot, readPayrollSnapshotSources } from './payrollLockSnapshot';

export type AttendancePeriodErrorCode =
  | 'invalid_week' | 'invalid_reason' | 'forbidden' | 'period_locked'
  | 'period_has_blockers' | 'reconciliation_stale' | 'active_lock_required'
  | 'persisted_readback_failed';

export class AttendancePeriodError extends Error {
  constructor(public readonly code: AttendancePeriodErrorCode, message: string) {
    super(message);
    this.name = 'AttendancePeriodError';
  }
}

export interface PeriodBlocker {
  staffId: string;
  workDate: string;
  kind: string;
  owner: 'worker' | 'supervisor' | 'hr';
  actionUrl: string;
  exceptionId: string | null;
  exceptionKind: string | null;
  status: string;
}

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
  blockers: PeriodBlocker[];
}

export interface WeeklyLockResult {
  weekStartDate: string;
  version: number;
  active: boolean;
  lockedAt: string;
  lockedBy: string;
  lockReason: string | null;
  unlockedAt: string | null;
  unlockedBy: string | null;
  unlockReason: string | null;
}

type Reader = <T extends Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;
interface MetricsRow extends Record<string, unknown> {
  active_staff_count: string | number; expected_day_count: string | number;
  approved_day_count: string | number; unapproved_overtime_hours: string | number;
  unapproved_sunday_hours: string | number; reconciliation_last_succeeded_at: string | null;
  reconciliation_fresh: boolean; active_lock: boolean;
}
interface BlockerRow extends Record<string, unknown> {
  staff_id: string; work_date: string; blocker_kind: string; exception_id: string | null;
  exception_kind: string | null; exception_status: string;
}
interface LockRow extends Record<string, unknown> {
  week_start_date: string; locked_at: string; locked_by: string; lock_reason: string | null;
  unlocked_at: string | null; unlocked_by: string | null; unlock_reason: string | null;
}
interface HistoryRow extends Record<string, unknown> { lock_version: string | number; result_snapshot: unknown }
interface CountRow extends Record<string, unknown> { affected_count: string | number }
interface RoleRow extends Record<string, unknown> { role: string }
interface LockPlan {
  week: string; end: string; version: number; action: 'lock' | 'relock';
  reason: string; snapshot: string; dailyCount: number;
}

export async function getPeriodReadiness(weekStartDate: string, reader: Reader = query): Promise<PeriodReadiness> {
  const weekEndDate = weekBounds(weekStartDate);
  const metrics = (await reader<MetricsRow>(metricsSql(), [weekStartDate, weekEndDate]))[0];
  if (!metrics) throw new Error('Attendance readiness query returned no metrics');
  const rows = await reader<BlockerRow>(blockersSql(), [weekStartDate, weekEndDate]);
  const blockers = rows.map((row) => mapBlocker(row, weekStartDate));
  const expected = integer(metrics.expected_day_count, 'expected day count');
  const approved = integer(metrics.approved_day_count, 'approved day count');
  const overtime = hours(metrics.unapproved_overtime_hours, 'unapproved overtime hours');
  const sunday = hours(metrics.unapproved_sunday_hours, 'unapproved Sunday hours');
  const fresh = metrics.reconciliation_fresh === true;
  return {
    weekStartDate, weekEndDate,
    activeStaffCount: integer(metrics.active_staff_count, 'active staff count'),
    expectedDayCount: expected, approvedDayCount: approved, blockerCount: blockers.length,
    unapprovedOvertimeHours: overtime, unapprovedSundayHours: sunday,
    reconciliationLastSucceededAt: metrics.reconciliation_last_succeeded_at,
    reconciliationFresh: fresh,
    readyToLock: fresh && expected > 0 && expected === approved && blockers.length === 0 &&
      overtime === 0 && sunday === 0 && metrics.active_lock !== true,
    blockers,
  };
}

export async function lockReadyWeek(args: {
  weekStartDate: string; actorUserId: string; reason: string;
}): Promise<WeeklyLockResult> {
  const result = await lockReadyWeeks({
    weekStartDates: [args.weekStartDate], actorUserId: args.actorUserId, reason: args.reason,
  });
  const lock = result.locks[0];
  if (!lock) fail('persisted_readback_failed', 'Attendance lock read-back returned no row');
  return lock;
}

export async function lockReadyWeeks<T = undefined>(args: {
  weekStartDates: readonly string[]; actorUserId: string; reason: string;
}, finalize?: (tx: TxnClient, locks: WeeklyLockResult[]) => Promise<T>): Promise<{
  locks: WeeklyLockResult[]; value: T | undefined;
}> {
  const weeks = [...new Set(args.weekStartDates)];
  if (weeks.length === 0) fail('invalid_week', 'At least one week_start_date is required');
  const ends = new Map(weeks.map((week) => [week, weekBounds(week)]));
  const reason = lockReason(args.reason);
  return transaction(async (tx) => {
    for (const week of [...weeks].sort()) await acquireAttendanceWeekLock(tx, week);
    await requirePermission(tx, args.actorUserId, 'create');
    const plans: LockPlan[] = [];
    for (const week of weeks) {
      const active = await activeLockForUpdate(tx, week);
      if (active && active.unlocked_at === null) fail('period_locked', `Attendance period ${week} is already locked`);
      const readiness = await getPeriodReadiness(week, tx.query.bind(tx));
      if (!readiness.reconciliationFresh) fail('reconciliation_stale', `Attendance reconciliation is stale for ${week}`);
      if (!readiness.readyToLock) fail('period_has_blockers', `Attendance period ${week} has blockers`);
      const prior = await latestHistoryForUpdate(tx, week);
      const version = prior ? integer(prior.lock_version, 'lock version') + 1 : 1;
      const end = ends.get(week)!;
      const dailyResults = await readPayrollSnapshotSources(tx, week, end);
      const expectedSnapshotDays = dailyResults.filter((row) => row.expected_day).length;
      if (expectedSnapshotDays !== readiness.expectedDayCount) {
        fail('period_has_blockers', `Attendance period ${week} changed during lock preflight`);
      }
      const payrollSnapshot = buildPayrollLockSnapshot(dailyResults, version);
      plans.push({ week, end, version, action: version === 1 ? 'lock' : 'relock', reason,
        snapshot: serializeJsonPayload({ readiness, payrollSnapshot }), dailyCount: dailyResults.length });
    }
    const locks: WeeklyLockResult[] = [];
    for (const plan of plans) {
      const active = await writeActiveLock(tx, { weekStartDate: plan.week, actorUserId: args.actorUserId }, plan.reason);
      await writeHistory(tx, plan.week, plan.version, plan.action, args.actorUserId,
        plan.reason, plan.snapshot, active.locked_at);
      await transitionDays(tx, plan.week, plan.end, 'locked', plan.version, null, plan.dailyCount);
      await writeEvent(tx, plan.week, plan.version, plan.action, args.actorUserId, plan.reason, plan.snapshot);
      locks.push(await readLock(tx, plan.week, plan.version));
    }
    const value = finalize ? await finalize(tx, locks) : undefined;
    return { locks, value };
  });
}

export async function unlockWeekWithHistory(args: {
  weekStartDate: string; actorUserId: string; reason: string;
}): Promise<WeeklyLockResult> {
  const weekEndDate = weekBounds(args.weekStartDate);
  const reason = unlockReason(args.reason);
  return transaction(async (tx) => {
    await acquireAttendanceWeekLock(tx, args.weekStartDate);
    await requirePermission(tx, args.actorUserId, 'edit');
    const active = await activeLockForUpdate(tx, args.weekStartDate);
    if (!active || active.unlocked_at != null) fail('active_lock_required', 'No active attendance lock exists');
    const prior = await latestHistoryForUpdate(tx, args.weekStartDate);
    if (!prior) fail('persisted_readback_failed', 'Active lock has no immutable history');
    const version = integer(prior.lock_version, 'lock version');
    const dailyResults = await lockedDaysForUpdate(tx, args.weekStartDate, weekEndDate);
    if (dailyResults.length === 0) fail('persisted_readback_failed', 'Active lock has no locked daily results');
    if (dailyResults.some((row) => !Number.isInteger(Number(row.locked_period_version)) ||
      Number(row.locked_period_version) !== version)) {
      fail('persisted_readback_failed', 'Active lock contains a different daily result version');
    }
    const snapshot = serializeJsonPayload({ priorLockSnapshot: prior.result_snapshot, dailyResults });
    const unlocked = await writeUnlock(tx, args);
    await writeHistory(tx, args.weekStartDate, version, 'unlock', args.actorUserId,
      reason, snapshot, unlocked.unlocked_at!);
    await transitionDays(tx, args.weekStartDate, weekEndDate, 'approved', null, version, dailyResults.length);
    await writeEvent(tx, args.weekStartDate, version, 'unlock', args.actorUserId, reason, snapshot);
    return readLock(tx, args.weekStartDate, version);
  });
}

function weekBounds(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('invalid_week', 'week_start_date must be a Monday YYYY-MM-DD');
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCDay() !== 1) {
    fail('invalid_week', 'week_start_date must be a Monday YYYY-MM-DD');
  }
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
}

function mapBlocker(row: BlockerRow, week: string): PeriodBlocker {
  const owner = row.blocker_kind === 'awaiting_worker' ? 'worker'
    : row.exception_id ? 'supervisor' : 'hr';
  const actionUrl = owner === 'worker' && row.exception_id
    ? `/my/attendance/corrections/new?exception_id=${encodeURIComponent(row.exception_id)}`
    : owner === 'supervisor' && row.exception_id
      ? `/staff/attendance/corrections?exception_id=${encodeURIComponent(row.exception_id)}`
      : `/staff/attendance/locks?week=${encodeURIComponent(week)}`;
  return { staffId: row.staff_id, workDate: row.work_date, kind: row.blocker_kind,
    owner, actionUrl, exceptionId: row.exception_id, exceptionKind: row.exception_kind,
    status: row.exception_status };
}

function fail(code: AttendancePeriodErrorCode, message: string): never { throw new AttendancePeriodError(code, message); }
function integer(value: unknown, label: string): number {
  const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Invalid attendance ${label}`); return parsed;
}
function hours(value: unknown, label: string): number {
  const parsed = Number(value); if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid attendance ${label}`); return parsed;
}
function lockReason(value: string): string {
  const reason = value.trim(); if (reason.length < 3 || reason.length > 1000) fail('invalid_reason', 'lock_reason must be 3 to 1000 characters'); return reason;
}
function unlockReason(value: string): string {
  const reason = value.trim(); if (reason.length < 10 || reason.length > 1000) fail('invalid_reason', 'unlock_reason must be 10 to 1000 characters'); return reason;
}

async function requirePermission(tx: TxnClient, actor: string, action: 'create' | 'edit'): Promise<void> {
  const user = await tx.queryOne<RoleRow>('SELECT role FROM users WHERE id = $1::uuid AND is_active = true', [actor]);
  if (!user || !['super_admin', 'admin'].includes(user.role)) {
    fail('forbidden', 'Attendance lock permission denied');
  }
  if (user.role === 'admin' && !await userHasPermission(actor, 'people.staff.attendance.locks', action)) {
    fail('forbidden', 'Attendance lock permission denied');
  }
}

async function activeLockForUpdate(tx: TxnClient, week: string): Promise<LockRow | null> {
  return tx.queryOne<LockRow>(`SELECT TO_CHAR(week_start_date, 'YYYY-MM-DD') AS week_start_date, locked_at::text, locked_by, lock_reason, unlocked_at::text, unlocked_by, unlock_reason FROM attendance_weekly_locks WHERE week_start_date = $1::date FOR UPDATE`, [week]);
}
async function latestHistoryForUpdate(tx: TxnClient, week: string): Promise<HistoryRow | null> {
  return tx.queryOne<HistoryRow>('SELECT lock_version, result_snapshot FROM attendance_weekly_lock_history WHERE week_start_date = $1::date ORDER BY lock_version DESC, recorded_at DESC LIMIT 1 FOR UPDATE', [week]);
}
async function lockedDaysForUpdate(tx: TxnClient, from: string, to: string): Promise<Record<string, unknown>[]> {
  return tx.query(`SELECT staff_id, TO_CHAR(work_date, 'YYYY-MM-DD') AS work_date, result_version, locked_period_version FROM attendance_daily_summaries WHERE work_date BETWEEN $1::date AND $2::date AND result_status = 'locked' ORDER BY work_date, staff_id FOR UPDATE`, [from, to]);
}

async function writeActiveLock(tx: TxnClient, args: { weekStartDate: string; actorUserId: string }, reason: string): Promise<LockRow> {
  const row = await tx.queryOne<LockRow>(`INSERT INTO attendance_weekly_locks (week_start_date, locked_by, lock_reason) VALUES ($1::date, $2::uuid, $3) ON CONFLICT (week_start_date) DO UPDATE SET locked_at = NOW(), locked_by = EXCLUDED.locked_by, lock_reason = EXCLUDED.lock_reason, unlocked_at = NULL, unlocked_by = NULL, unlock_reason = NULL RETURNING TO_CHAR(week_start_date, 'YYYY-MM-DD') AS week_start_date, locked_at::text, locked_by, lock_reason, unlocked_at::text, unlocked_by, unlock_reason`, [args.weekStartDate, args.actorUserId, reason]);
  if (!row) fail('persisted_readback_failed', 'Active lock write returned no row');
  return row;
}
async function writeUnlock(tx: TxnClient, args: { weekStartDate: string; actorUserId: string; reason: string }): Promise<LockRow> {
  const row = await tx.queryOne<LockRow>(`UPDATE attendance_weekly_locks SET unlocked_at = NOW(), unlocked_by = $2::uuid, unlock_reason = $3 WHERE week_start_date = $1::date AND unlocked_at IS NULL RETURNING TO_CHAR(week_start_date, 'YYYY-MM-DD') AS week_start_date, locked_at::text, locked_by, lock_reason, unlocked_at::text, unlocked_by, unlock_reason`, [args.weekStartDate, args.actorUserId, args.reason.trim()]);
  if (!row) fail('active_lock_required', 'No active attendance lock exists');
  return row;
}
async function writeHistory(tx: TxnClient, week: string, version: number, action: string,
  actor: string, reason: string, snapshot: string, recordedAt: string): Promise<void> {
  const row = await tx.queryOne<HistoryRow>(`INSERT INTO attendance_weekly_lock_history (week_start_date, lock_version, action, actor_user_id, reason, result_snapshot, recorded_at) VALUES ($1::date, $2::bigint, $3, $4::uuid, $5, $6::jsonb, $7::timestamptz) RETURNING lock_version, result_snapshot`, [week, version, action, actor, reason, snapshot, recordedAt]);
  if (!row) fail('persisted_readback_failed', 'Lock history write returned no row');
}
async function transitionDays(tx: TxnClient, from: string, to: string, status: 'locked' | 'approved', version: number | null, lockedVersion: number | null, expected: number): Promise<void> {
  const row = await tx.queryOne<CountRow>(`WITH changed AS (
    UPDATE attendance_daily_summaries ds
    SET result_status = $3::text, locked_period_version = $4::bigint,
      result_version = result_version + 1
    WHERE ds.work_date BETWEEN $1::date AND $2::date AND ds.result_status = $5
      AND ($6::bigint IS NULL OR ds.locked_period_version = $6::bigint)
      AND ($3::text <> 'locked' OR EXISTS (
        SELECT 1 FROM staff s WHERE s.id = ds.staff_id
          AND ${employmentEffectivePredicate('s', 'ds.work_date')}
      ))
    RETURNING 1
  ) SELECT COUNT(*)::int AS affected_count FROM changed`,
  [from, to, status, version, status === 'locked' ? 'approved' : 'locked', lockedVersion]);
  if (integer(row?.affected_count, 'transition count') !== expected) fail('persisted_readback_failed', 'Attendance result transition count changed');
}
async function writeEvent(tx: TxnClient, week: string, version: number, action: string, actor: string, reason: string, snapshot: string): Promise<void> {
  const before = serializeJsonPayload({});
  const row = await tx.queryOne<{ id: string }>(`INSERT INTO attendance_decision_events (entity_type, entity_key, action, actor_user_id, reason, before_value, after_value) VALUES ('weekly_lock', $1, $2, $3::uuid, $4, $5::jsonb, $6::jsonb) RETURNING id`, [`${week}:v${version}`, action, actor, reason, before, snapshot]);
  if (!row) fail('persisted_readback_failed', 'Lock decision event returned no row');
}
async function readLock(tx: TxnClient, week: string, version: number): Promise<WeeklyLockResult> {
  const row = await tx.queryOne<LockRow>(`SELECT TO_CHAR(week_start_date, 'YYYY-MM-DD') AS week_start_date, locked_at::text, locked_by, lock_reason, unlocked_at::text, unlocked_by, unlock_reason FROM attendance_weekly_locks WHERE week_start_date = $1::date`, [week]);
  if (!row) fail('persisted_readback_failed', 'Attendance lock read-back returned no row');
  return { weekStartDate: row.week_start_date, version, active: row.unlocked_at == null,
    lockedAt: row.locked_at, lockedBy: row.locked_by, lockReason: row.lock_reason,
    unlockedAt: row.unlocked_at, unlockedBy: row.unlocked_by, unlockReason: row.unlock_reason };
}

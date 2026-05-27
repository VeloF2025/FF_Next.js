/**
 * Pulse · Bulk Actions service (PRD-061 Phase D, FR-BULK-*).
 *
 * Owns the cross-staff scope verification and the audit-write convention
 * that every bulk action goes through. The API route is a thin shell over
 * these helpers — keeps the security guarantees (FR-BULK-05: no partial
 * commits; every staff scope-checked before any write) in one place.
 */

import { sql, transaction, type TxnClient } from '@/lib/db-pool';
import { staffIdsSupervisedBy } from './supervisorScope';
import { getStaffIdForUser } from '@/services/staff/staffAccessService';
import type { AuthUser } from '@/lib/auth/types';

export type BulkActionKind = 'bulk_lock' | 'bulk_correction_request';

const MIN_REASON_LEN = 10;

export class BulkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BulkValidationError';
  }
}

export class BulkScopeViolation extends Error {
  readonly outOfScopeStaffIds: ReadonlyArray<string>;
  constructor(ids: ReadonlyArray<string>) {
    super(`${ids.length} staff are outside your supervisor scope`);
    this.name = 'BulkScopeViolation';
    this.outOfScopeStaffIds = ids;
  }
}

export class BulkConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BulkConflict';
  }
}

export function validateReason(reason: unknown): string {
  if (typeof reason !== 'string') {
    throw new BulkValidationError('reason must be a string');
  }
  const trimmed = reason.trim();
  if (trimmed.length < MIN_REASON_LEN) {
    throw new BulkValidationError(`reason must be at least ${MIN_REASON_LEN} characters`);
  }
  return trimmed;
}

/**
 * FR-BULK-05: every staff_id in the selection must be in the actor's
 * supervisor chain. Super_admin/admin bypass. Anything else returns
 * BulkScopeViolation listing the offending IDs (the API maps to 403).
 *
 * The actor's staff_id is looked up once; the supervised set is a single
 * SQL round-trip; the intersection is then in-memory.
 */
export async function assertScopeOver(
  user: AuthUser,
  staffIds: ReadonlyArray<string>
): Promise<void> {
  if (user.role === 'super_admin' || user.role === 'admin') return;
  const viewerStaffId = await getStaffIdForUser(user.id);
  if (!viewerStaffId) {
    throw new BulkScopeViolation(staffIds);
  }
  const supervised = new Set(await staffIdsSupervisedBy(viewerStaffId));
  const offending = staffIds.filter((id) => !supervised.has(id));
  if (offending.length > 0) {
    throw new BulkScopeViolation(offending);
  }
}

export interface BulkLockInput {
  weekStartDates: ReadonlyArray<string>; // Monday YYYY-MM-DD
  reason: string;                        // already validated by validateReason
  /**
   * Optional explicit staff list. When omitted, every staff with at least
   * one daily_summary in the requested weeks is included. The explicit
   * list can never *expand* scope — it is intersected with the implied
   * set and with the actor's supervisor scope.
   */
  staffIdsOverride?: ReadonlyArray<string>;
}

export interface BulkLockResult {
  batchId: string;
  weeks: ReadonlyArray<string>;
  staffAudited: number;
  /** Locks actually inserted (a week already locked is a 409, not a no-op). */
  locksCreated: number;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === '23505'
  );
}

/** Validate that a date is YYYY-MM-DD AND falls on a Monday (ISO payroll convention). */
function assertIsoMonday(s: string): void {
  if (!YMD_RE.test(s)) {
    throw new BulkValidationError(`week_start_date '${s}' must be YYYY-MM-DD`);
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new BulkValidationError(`week_start_date '${s}' is not a real date`);
  }
  if (d.getUTCDay() !== 1) {
    throw new BulkValidationError(`week_start_date '${s}' must be a Monday`);
  }
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Run the bulk-lock inside a single transaction (FR-BULK-04). All weeks
 * succeed or all weeks roll back — payroll close should never end up
 * "weeks 14 and 15 locked, week 16 silently skipped because the cron
 * stomped on us mid-write".
 *
 * Locks already held by the system surface as BulkConflict — the operator
 * needs to know rather than have us silently no-op.
 */
export async function runBulkLock(
  user: AuthUser,
  input: BulkLockInput
): Promise<BulkLockResult> {
  if (input.weekStartDates.length === 0) {
    throw new BulkValidationError('At least one week is required');
  }
  // Dedupe + validate up front so we don't mid-transaction discover a
  // bad date and have to roll back a partially-good commit.
  const weeks = Array.from(new Set(input.weekStartDates));
  for (const wk of weeks) assertIsoMonday(wk);

  // Resolve the affected staff list per week. We'll union and unique
  // them for the scope check, then attribute audit rows back to the
  // specific (week, staff) intersection.
  const overrideStaff = input.staffIdsOverride;
  const perWeekStaff = await resolvePerWeekStaff(weeks, overrideStaff);
  const allStaffIds = Array.from(
    new Set(perWeekStaff.flatMap((w) => w.staffIds))
  );
  if (allStaffIds.length === 0) {
    throw new BulkValidationError(
      'No staff have attendance rows for the requested weeks; nothing to lock.'
    );
  }
  await assertScopeOver(user, allStaffIds);

  return transaction(async (txn) => {
    const batchId = (
      await txn.queryOne<{ id: string }>(`SELECT gen_random_uuid()::text AS id`)
    )?.id;
    if (!batchId) throw new Error('Failed to allocate batch_id');

    let locksCreated = 0;
    let staffAudited = 0;
    for (const { week, staffIds } of perWeekStaff) {
      const existing = await txn.queryOne<{ unlocked_at: string | null }>(
        `SELECT unlocked_at FROM attendance_weekly_locks WHERE week_start_date = $1`,
        [week]
      );
      if (existing && existing.unlocked_at === null) {
        throw new BulkConflict(
          `Week ${week} is already locked. Unlock first via /staff/attendance/locks if a re-lock is required.`
        );
      }
      // INSERT ... ON CONFLICT DO UPDATE so a previously-unlocked week
      // (existing row with unlocked_at set) gets re-locked rather than
      // duplicate-keying. Catch the rare 23505 anyway — two admins can
      // race on a week-list intersection, and surfacing 409 (CONFLICT) is
      // friendlier than the default 500 the unique-violation would yield.
      try {
        await txn.query(
          `INSERT INTO attendance_weekly_locks (week_start_date, locked_by, lock_reason)
           VALUES ($1, $2, $3)
           ON CONFLICT (week_start_date) DO UPDATE
             SET locked_at     = NOW(),
                 locked_by     = EXCLUDED.locked_by,
                 lock_reason   = EXCLUDED.lock_reason,
                 unlocked_at   = NULL,
                 unlocked_by   = NULL,
                 unlock_reason = NULL`,
          [week, user.id, input.reason]
        );
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new BulkConflict(
            `Week ${week} was concurrently locked by another administrator. Re-load and retry.`
          );
        }
        throw err;
      }
      locksCreated += 1;
      staffAudited += await writeAuditRows(txn, {
        batchId,
        actorUserId: user.id,
        action: 'bulk_lock',
        reason: input.reason,
        rows: staffIds.map((staffId) => ({ staffId, targetDate: week })),
      });
    }

    return { batchId, weeks, staffAudited, locksCreated };
  });
}

/**
 * Fetch the staff with daily_summaries in each week. When the caller
 * supplied `overrideStaffIds`, we intersect — the override never expands
 * the implied set.
 */
async function resolvePerWeekStaff(
  weeks: ReadonlyArray<string>,
  overrideStaffIds: ReadonlyArray<string> | undefined
): Promise<Array<{ week: string; staffIds: string[] }>> {
  const out: Array<{ week: string; staffIds: string[] }> = [];
  for (const week of weeks) {
    const weekEnd = addDays(week, 6);
    const baseRows = await sql<{ staff_id: string }>`
      SELECT DISTINCT staff_id::text AS staff_id
      FROM attendance_daily_summaries
      WHERE work_date >= ${week}::date AND work_date <= ${weekEnd}::date
    `;
    let staffIds = baseRows.map((r) => r.staff_id);
    if (overrideStaffIds && overrideStaffIds.length > 0) {
      const override = new Set(overrideStaffIds);
      staffIds = staffIds.filter((id) => override.has(id));
    }
    out.push({ week, staffIds });
  }
  return out;
}

/**
 * Append per-staff audit rows for one bulk action. Returns the row count
 * inserted — bulk callers sum these for the response.
 */
export async function writeAuditRows(
  txn: TxnClient,
  args: {
    batchId: string;
    actorUserId: string;
    action: BulkActionKind;
    reason: string;
    rows: ReadonlyArray<{ staffId: string; targetDate: string }>;
  }
): Promise<number> {
  if (args.rows.length === 0) return 0;
  // Multi-VALUES insert avoids N round-trips. We bind one tuple per row
  // and let Postgres handle the rest.
  const tuples: string[] = [];
  const params: unknown[] = [];
  for (const r of args.rows) {
    params.push(args.batchId, args.actorUserId, args.action, r.staffId, r.targetDate, args.reason);
    const base = params.length - 6;
    tuples.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
    );
  }
  await txn.query(
    `INSERT INTO attendance_bulk_action_audit
       (batch_id, actor_user_id, action, target_staff_id, target_week_or_date, reason_note)
     VALUES ${tuples.join(', ')}`,
    params
  );
  return args.rows.length;
}

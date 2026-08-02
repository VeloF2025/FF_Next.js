import type { TxnClient } from '@/lib/db-pool';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: vi.fn(), transaction: mocks.transaction }));
vi.mock('@/lib/permissions', () => ({ userHasPermission: vi.fn(async () => true) }));

import { createAndApproveAdjustmentTxn } from '@/modules/attendance/corrections/guardedApproval';
import { lockReadyWeek } from '../periodQueries';

const WEEK = '2026-08-03';
const LOCKED_AT = '2026-08-10T02:00:00Z';

describe('weekly lock and correction interleaving', () => {
  beforeEach(() => vi.clearAllMocks());

  it('finishes the lock before a waiting approval, which then fails before mutation', async () => {
    const weekLock = new AdvisoryCoordinator();
    const snapshot = new Barrier();
    const state = { activeLock: false, adjustmentWrites: 0 };
    mocks.transaction.mockImplementation(async (work) => {
      const tx = txn(weekLock, snapshot, state);
      try {
        return await work(tx);
      } finally {
        if (tx.ownsWeekLock) weekLock.release();
      }
    });

    const locking = lockReadyWeek({
      weekStartDate: WEEK, actorUserId: 'user-admin', reason: 'Approved payroll close',
    });
    await snapshot.waitUntilReached();

    const approving = createAndApproveAdjustmentTxn({
      entryId: 'entry-1', entryUpdatedAt: '2026-08-03T15:00:00Z',
      staffId: '00000000-0000-4000-8000-000000000001', workDate: WEEK,
      requestedBy: 'staff-1', reviewerId: 'user-admin', adjustmentKind: 'wrong_clock_out_time',
      reason: 'Correct recorded close', reviewNote: 'Reviewed evidence',
      adjustedClockInAt: null, adjustedClockOutAt: new Date('2026-08-03T15:00:00Z'),
      adjustedSiteGeofenceId: null,
    });
    await weekLock.waitUntilContended();
    snapshot.resume();

    await expect(locking).resolves.toMatchObject({ active: true, version: 1 });
    await expect(approving).rejects.toMatchObject({ code: 'period_locked' });
    expect(state.adjustmentWrites).toBe(0);
  });
});

class Barrier {
  private reachedResolve!: () => void;
  private resumeResolve!: () => void;
  private readonly reached = new Promise<void>((resolve) => { this.reachedResolve = resolve; });
  private readonly resumed = new Promise<void>((resolve) => { this.resumeResolve = resolve; });
  async pause(): Promise<void> { this.reachedResolve(); await this.resumed; }
  waitUntilReached(): Promise<void> { return this.reached; }
  resume(): void { this.resumeResolve(); }
}

class AdvisoryCoordinator {
  private held = false;
  private waiter: (() => void) | null = null;
  private contentionResolve!: () => void;
  private readonly contended = new Promise<void>((resolve) => { this.contentionResolve = resolve; });
  async acquire(): Promise<void> {
    if (!this.held) { this.held = true; return; }
    this.contentionResolve();
    await new Promise<void>((resolve) => { this.waiter = resolve; });
    this.held = true;
  }
  waitUntilContended(): Promise<void> { return this.contended; }
  release(): void { this.held = false; const next = this.waiter; this.waiter = null; next?.(); }
}

function txn(
  weekLock: AdvisoryCoordinator,
  snapshot: Barrier,
  state: { activeLock: boolean; adjustmentWrites: number },
): TxnClient & { ownsWeekLock: boolean } {
  const client = {
    ownsWeekLock: false,
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      if (/pg_advisory_xact_lock/i.test(text)) {
        if (params[0] === 'attendance-week-lock') {
          await weekLock.acquire();
          client.ownsWeekLock = true;
        }
        return [{ acquired: '' }];
      }
      if (/active_staff_count/i.test(text)) return [{
        active_staff_count: 1, expected_day_count: 6, approved_day_count: 6,
        unapproved_overtime_hours: 0, unapproved_sunday_hours: 0,
        reconciliation_last_succeeded_at: LOCKED_AT, reconciliation_fresh: true,
        active_lock: false,
      }];
      if (/blocker_kind/i.test(text)) return [];
      if (/attendance:payroll-lock-snapshot/i.test(text)) {
        await snapshot.pause();
        return Array.from({ length: 6 }, (_, index) => ({
          staff_id: '00000000-0000-4000-8000-000000000001', employee_id: 'EMP001',
          full_name: 'Alice Example', work_date: `2026-08-0${index + 3}`, expected_day: true,
          result_version: 1, approved_regular_hrs: 8, approved_overtime_hrs: 0,
          approved_sunday_hrs: 0, approved_holiday_hrs: 0, leave_hrs: 0, unpaid_hrs: 0,
          attendance_classification: null, project_id: null, site_id: null,
        }));
      }
      if (/INSERT INTO attendance_adjustments/i.test(text)) {
        state.adjustmentWrites += 1;
        return [{ id: 'adjustment-1' }];
      }
      return [];
    }),
    queryOne: vi.fn(async (text: string) => {
      if (/FROM users/i.test(text)) return { role: 'admin' };
      if (/active_period_lock/i.test(text)) return { active_period_lock: state.activeLock };
      if (/attendance_weekly_locks/i.test(text) && /FOR UPDATE/i.test(text)) return null;
      if (/FROM attendance_weekly_lock_history/i.test(text)) return null;
      if (/INSERT INTO attendance_weekly_locks/i.test(text)) {
        state.activeLock = true;
        return lockRow();
      }
      if (/INSERT INTO attendance_weekly_lock_history/i.test(text)) return { lock_version: 1 };
      if (/UPDATE attendance_daily_summaries/i.test(text)) return { affected_count: 6 };
      if (/INSERT INTO attendance_decision_events/i.test(text)) return { id: 'event-1' };
      if (/SELECT .*FROM attendance_weekly_locks/i.test(text)) return lockRow();
      return null;
    }),
    client: {} as TxnClient['client'],
  };
  return client;
}

function lockRow() {
  return { week_start_date: WEEK, locked_at: LOCKED_AT, locked_by: 'user-admin',
    lock_reason: 'Approved payroll close', unlocked_at: null, unlocked_by: null,
    unlock_reason: null };
}

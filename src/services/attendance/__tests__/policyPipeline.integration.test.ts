import type { TxnClient } from '@/lib/db-pool';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/db-pool', () => mocks);
vi.mock('@/lib/permissions', () => ({ userHasPermission: vi.fn(async () => true) }));

import { lockReadyWeek, getPeriodReadiness } from '@/modules/attendance/workflow/periodQueries';
import { createPayrollExportService } from '@/services/attendance/payroll/exportService';
import { calculateDailyResult } from '@/services/attendance/policy/calculateDailyResult';
import { VELOCITY_FIXED_POLICY } from '@/services/attendance/policy/defaultPolicy';
import { upsertDailyProjectionTxn } from '@/services/attendance/policy/projectionRepository';

const WEEK = '2026-08-03';
const STAFF = '00000000-0000-4000-8000-000000000001';
const POLICY = '00000000-0000-4000-8000-000000000002';
const ACTOR = '00000000-0000-4000-8000-000000000003';
const LOCKED_AT = '2026-08-10T02:00:00.000Z';

describe('calculator to locked payroll export pipeline', () => {
  beforeEach(() => vi.clearAllMocks());

  it('carries six clean calculated days through projection, readiness, lock and export', async () => {
    const state = new PipelineState();
    mocks.transaction.mockImplementation(async (work) => work(state.tx));

    for (let offset = 0; offset < 6; offset += 1) {
      const workDate = `2026-08-0${offset + 3}`;
      const saturday = offset === 5;
      const result = calculateDailyResult({
        policy: VELOCITY_FIXED_POLICY,
        evidence: {
          workDate,
          clockInAt: new Date(`${workDate}T06:00:00Z`),
          clockOutAt: new Date(`${workDate}T${saturday ? '11' : '15'}:00:00Z`),
          clockOutSource: 'device',
        },
        isPublicHoliday: false,
      });
      expect(result.status).toBe('approved');
      await upsertDailyProjectionTxn(state.tx, { staffId: STAFF, policyId: POLICY, result });
    }

    await expect(getPeriodReadiness(WEEK, state.tx.query.bind(state.tx))).resolves.toMatchObject({
      expectedDayCount: 6, approvedDayCount: 6, blockerCount: 0, readyToLock: true,
    });
    await expect(lockReadyWeek({
      weekStartDate: WEEK, actorUserId: ACTOR, reason: 'Approved payroll pipeline',
    })).resolves.toMatchObject({ active: true, version: 1 });

    const prepare = createPayrollExportService({
      transaction: mocks.transaction,
      storage: { upload: vi.fn(), remove: vi.fn() },
    });
    const exported = await prepare({
      weekStartDate: WEEK, expectedLockVersion: 1, actorUserId: ACTOR,
      format: 'csv', dryRun: true,
    });

    expect(exported).toMatchObject({
      dryRun: true, lockVersion: 1, rowCount: 6,
      totals: { ordinary_hours: '45.00', overtime_hours: '0.00' },
    });
    expect(exported.rows.map((row) => row.ordinary_hours)).toEqual([
      '8.00', '8.00', '8.00', '8.00', '8.00', '5.00',
    ]);
  });
});

interface DailyState extends Record<string, unknown> {
  staff_id: string; work_date: string; result_status: string; result_version: number;
  approved_regular_hrs: number; approved_overtime_hrs: number;
  approved_sunday_hrs: number; approved_holiday_hrs: number;
  leave_hrs: number; unpaid_hrs: number; attendance_classification: string | null;
  locked_period_version: number | null;
}

class PipelineState {
  readonly days = new Map<string, DailyState>();
  active = false;
  history: Record<string, unknown> | null = null;

  readonly tx: TxnClient = {
    query: async <T extends Record<string, unknown>>(text: string, _params: unknown[] = []) => {
      if (/pg_advisory_xact_lock/i.test(text)) return [{ acquired: '' }] as T[];
      if (/active_staff_count/i.test(text)) return [{
        active_staff_count: 1, expected_day_count: 6,
        approved_day_count: [...this.days.values()].filter((day) => day.result_status === 'approved').length,
        unapproved_overtime_hours: 0, unapproved_sunday_hours: 0,
        reconciliation_last_succeeded_at: LOCKED_AT, reconciliation_fresh: true,
        active_lock: this.active,
      }] as T[];
      if (/blocker_kind/i.test(text)) return [];
      if (/attendance:payroll-lock-snapshot/i.test(text)) return this.snapshotSources() as T[];
      if (/payroll:locked-days/i.test(text)) return [...this.days.values()].map((day) => ({
        ...day, approved_regular_hrs: String(day.approved_regular_hrs),
        approved_overtime_hrs: String(day.approved_overtime_hrs),
        approved_sunday_hrs: String(day.approved_sunday_hrs),
        approved_holiday_hrs: String(day.approved_holiday_hrs), leave_hrs: String(day.leave_hrs),
        unpaid_hrs: String(day.unpaid_hrs),
      })) as T[];
      return [];
    },
    queryOne: async <T extends Record<string, unknown>>(text: string, params: unknown[] = []) => {
      if (/payroll:actor-role/i.test(text)) return { role: 'admin' } as T;
      if (/payroll:active-lock/i.test(text)) return this.lockRow() as T;
      if (/payroll:lock-history/i.test(text)) return this.history as T;
      if (/active_period_lock/i.test(text)) return { active_period_lock: this.active } as T;
      if (/SELECT calculation_fingerprint/i.test(text)) return null;
      if (/SELECT overtime_rule_id/i.test(text)) return { overtime_rule_id: POLICY } as T;
      if (/INSERT INTO attendance_daily_summaries/i.test(text)) {
        this.days.set(String(params[1]), {
          staff_id: String(params[0]), work_date: String(params[1]),
          result_status: String(params[12]), result_version: 1,
          approved_regular_hrs: Number(params[15]), approved_overtime_hrs: Number(params[16]),
          approved_sunday_hrs: Number(params[17]), approved_holiday_hrs: Number(params[18]),
          leave_hrs: Number(params[9]), unpaid_hrs: Number(params[10]),
          attendance_classification: params[11] == null ? null : String(params[11]),
          locked_period_version: null,
        });
        return { result_version: 1 } as T;
      }
      if (/FROM users/i.test(text)) return { role: 'admin' } as T;
      if (/attendance_weekly_locks/i.test(text) && /FOR UPDATE/i.test(text)) return null;
      if (/FROM attendance_weekly_lock_history/i.test(text)) return null;
      if (/INSERT INTO attendance_weekly_locks/i.test(text)) {
        this.active = true;
        return this.lockRow() as T;
      }
      if (/INSERT INTO attendance_weekly_lock_history/i.test(text)) {
        this.history = {
          lock_version: 1, action: 'lock', actor_user_id: ACTOR, reason: String(params[4]),
          recorded_at: String(params[6]), result_snapshot: JSON.parse(String(params[5])),
        };
        return { lock_version: 1, result_snapshot: this.history.result_snapshot } as T;
      }
      if (/UPDATE attendance_daily_summaries ds/i.test(text)) {
        for (const day of this.days.values()) {
          day.result_status = 'locked'; day.locked_period_version = 1; day.result_version += 1;
        }
        return { affected_count: this.days.size } as T;
      }
      if (/INSERT INTO attendance_decision_events/i.test(text)) return { id: 'event-1' } as T;
      if (/SELECT .*FROM attendance_weekly_locks/i.test(text)) return this.lockRow() as T;
      return null;
    },
    client: {} as TxnClient['client'],
  };

  private snapshotSources(): Record<string, unknown>[] {
    return [...this.days.values()].map((day) => ({
      ...day, employee_id: 'EMP001', full_name: 'Alice Example', expected_day: true,
      project_id: 'project-1', site_id: 'site-1',
    }));
  }

  private lockRow(): Record<string, unknown> {
    return { week_start_date: WEEK, locked_at: LOCKED_AT, locked_by: ACTOR,
      lock_reason: 'Approved payroll pipeline', unlocked_at: null, unlocked_by: null,
      unlock_reason: null };
  }
}

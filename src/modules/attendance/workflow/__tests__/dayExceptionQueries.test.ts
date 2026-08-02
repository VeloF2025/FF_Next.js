import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TxnClient } from '@/lib/db-pool';
import type { DayExceptionKind } from '../types';
import {
  ADJUSTMENT_ID,
  ENTRY_ID,
  EXCEPTION_ID,
  QUEUE_ROW,
  STAFF_A,
  STAFF_B,
  SUPERVISOR,
} from './dayExceptionQueries.fixtures';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), transaction: vi.fn(), resolveScope: vi.fn(),
  userHasPermission: vi.fn(), acquireWeekLock: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => ({ query: mocks.query, transaction: mocks.transaction }));
vi.mock('@/services/attendance/search/scope', () => ({ resolveScope: mocks.resolveScope }));
vi.mock('@/lib/permissions', () => ({ userHasPermission: mocks.userHasPermission }));
vi.mock('@/modules/attendance/corrections/lockQueries', () => ({
  acquireAttendanceWeekLock: mocks.acquireWeekLock,
  isoWeekMonday: () => '2026-07-27',
}));

import {
  DayExceptionWorkflowError,
  decideDayException,
  listDayExceptions,
} from '../dayExceptionQueries';

interface State {
  kind: DayExceptionKind;
  currentRole: string;
  status: 'open' | 'awaiting_worker' | 'awaiting_supervisor' | 'resolved' | 'cancelled';
  version: number;
  locked: boolean;
  staffId: string;
  adjustments: Map<string, 'pending' | 'approved' | 'rejected'>;
  exceptionAdjustmentId: string | null;
  classification: string | null;
  approved: Record<string, number> | null;
  failEvent: boolean;
  committed: boolean;
  siblingStatus: 'open' | 'awaiting_worker' | 'awaiting_supervisor' | null;
  siblingVersion: number | null;
  resultStatus: 'approved' | 'awaiting_worker' | 'awaiting_supervisor';
  writes: string[];
}

function installTransaction(overrides: Partial<State> = {}): State {
  const state: State = {
    kind: 'missing_clock_out', currentRole: 'manager',
    status: 'awaiting_supervisor', version: 4, locked: false, staffId: STAFF_A,
    adjustments: new Map([[ADJUSTMENT_ID, 'pending']]), exceptionAdjustmentId: ADJUSTMENT_ID,
    classification: null, approved: null,
    failEvent: false, committed: false, siblingStatus: null, siblingVersion: null,
    resultStatus: 'awaiting_supervisor', writes: [], ...overrides,
  };
  const deleteAdjustment = (text: string, params: unknown[]): { id: string } | null | undefined => {
    if (!/DELETE FROM attendance_adjustments/i.test(text)) return undefined;
    const adjustmentId = params[0] as string;
    const existed = state.adjustments.delete(adjustmentId);
    state.writes.push('adjustment_delete');
    return existed ? { id: adjustmentId } : null;
  };
  const tx = {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      const deletedAdjustment = deleteAdjustment(text, params);
      if (deletedAdjustment !== undefined) return deletedAdjustment ? [deletedAdjustment] : [];
      if (/UPDATE attendance_day_exceptions[\s\S]+SET result_version/i.test(text)) {
        state.writes.push('sibling_version'); state.siblingVersion = state.version;
      }
      return [];
    }),
    queryOne: vi.fn(async (text: string, params: unknown[] = []) => {
      const deletedAdjustment = deleteAdjustment(text, params);
      if (deletedAdjustment !== undefined) return deletedAdjustment;
      if (/SELECT role[\s\S]+FROM users/i.test(text)) return { role: state.currentRole };
      if (/SELECT staff_id, TO_CHAR\(work_date/i.test(text)) {
        return { staff_id: state.staffId, work_date: '2026-07-31' };
      }
      if (/FOR UPDATE OF de/i.test(text)) return {
        exception_id: EXCEPTION_ID, staff_id: state.staffId, work_date: '2026-07-31',
        entry_id: ENTRY_ID, adjustment_id: state.exceptionAdjustmentId,
        kind: state.kind, status: state.status, result_version: state.version,
        summary_result_version: state.version, period_locked: state.locked,
        scheduled_paid_hrs: '8', result_status: 'awaiting_supervisor',
        approved_regular_hrs: null, approved_overtime_hrs: null,
        approved_sunday_hrs: null, approved_holiday_hrs: null, leave_hrs: '0', unpaid_hrs: '0',
        attendance_classification: null,
        adjustment_status: state.exceptionAdjustmentId
          ? state.adjustments.get(state.exceptionAdjustmentId) ?? null
          : null,
      };
      if (/UPDATE attendance_daily_summaries/i.test(text)) {
        state.writes.push('summary'); state.version += 1;
        if (/approved_regular_hrs = NULL/i.test(text)) {
          state.resultStatus = /result_status = 'awaiting_worker'/i.test(text) ? 'awaiting_worker' : 'approved';
        }
        else if (state.siblingStatus === 'awaiting_worker' &&
          /sibling\.status = 'awaiting_worker'\) THEN 'awaiting_worker'/i.test(text)) {
          state.resultStatus = 'awaiting_worker';
        } else if (state.siblingStatus && /sibling\.status IN \('open', 'awaiting_worker', 'awaiting_supervisor'\)/i.test(text)) {
          state.resultStatus = 'awaiting_supervisor';
        } else state.resultStatus = 'approved';
        if (!/approved_regular_hrs = NULL/i.test(text)) {
          state.approved = { regular: Number(params[3]), overtime: Number(params[4]), sunday: Number(params[5]),
            holiday: Number(params[6]), leave: Number(params[7]), unpaid: Number(params[8]) };
          state.classification = params[9] as string | null;
        } else { state.approved = null; state.classification = null; }
        return { result_version: state.version };
      }
      if (/UPDATE attendance_adjustments/i.test(text)) {
        const adjustmentId = params[0] as string;
        if (state.adjustments.get(adjustmentId) !== 'pending') return null;
        state.writes.push('adjustment');
        state.adjustments.set(adjustmentId, params[1] as 'approved' | 'rejected');
        return { id: adjustmentId };
      }
      if (/UPDATE attendance_day_exceptions/i.test(text)) {
        state.writes.push('exception');
        if (/SET status = 'awaiting_worker'/i.test(text)) {
          state.status = 'awaiting_worker';
          if (/adjustment_id = NULL/i.test(text)) state.exceptionAdjustmentId = null;
        } else state.status = 'resolved';
        return { id: EXCEPTION_ID };
      }
      if (/INSERT INTO attendance_decision_events/i.test(text)) {
        if (state.failEvent) throw new Error('audit unavailable');
        state.writes.push('event'); return { id: '77777777-7777-4777-8777-777777777777' };
      }
      if (/AS exception_id[\s\S]+FROM attendance_day_exceptions/i.test(text)) return {
        exception_id: EXCEPTION_ID, exception_status: state.status,
        exception_result_version: state.version, exception_classification: state.classification,
        resolution_reason: state.status === 'resolved' ? 'Confirmed against site close record' : null,
        staff_id: state.staffId, work_date: '2026-07-31',
        result_status: state.resultStatus,
        summary_result_version: state.version,
        approved_regular_hrs: state.approved?.regular ?? null,
        approved_overtime_hrs: state.approved?.overtime ?? null,
        approved_sunday_hrs: state.approved?.sunday ?? null,
        approved_holiday_hrs: state.approved?.holiday ?? null,
        leave_hrs: state.approved?.leave ?? 0, unpaid_hrs: state.approved?.unpaid ?? 0,
        attendance_classification: state.classification,
      };
      throw new Error(`Unexpected SQL: ${text}`);
    }), client: {},
  } as unknown as TxnClient;
  mocks.transaction.mockImplementation(async (callback: (client: TxnClient) => Promise<unknown>) => {
    const snapshot = structuredClone(state);
    try {
      const result = await callback(tx);
      state.committed = true;
      return result;
    } catch (error) {
      Object.assign(state, snapshot);
      throw error;
    }
  });
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveScope.mockResolvedValue({ allowedStaffIds: [STAFF_A], note: { kind: 'scoped', staffCount: 1 } });
  mocks.userHasPermission.mockResolvedValue(true);
  mocks.acquireWeekLock.mockResolvedValue(undefined);
});

describe('listDayExceptions', () => {
  it('returns only workers in supervisor scope and audited selfie identifiers', async () => {
    mocks.query.mockResolvedValue([QUEUE_ROW, { ...QUEUE_ROW, staff_id: STAFF_B }]);
    const result = await listDayExceptions({ user: SUPERVISOR, status: 'open', limit: 100 });
    expect(result.items.every((item) => item.staffId === STAFF_A)).toBe(true);
    expect(result.items[0]?.evidence.selfies).toEqual([{ entryId: ENTRY_ID, kind: 'in' }]);
    expect(JSON.stringify(result)).not.toContain('selfie_in_url');
    expect(result.limit).toBe(100);
  });

  it('returns an empty queue without an unscoped SQL read when scope is empty', async () => {
    mocks.resolveScope.mockResolvedValue({ allowedStaffIds: [], note: { kind: 'no_scope', reason: 'not linked' } });
    await expect(listDayExceptions({ user: SUPERVISOR, status: 'unresolved', limit: 50 }))
      .resolves.toMatchObject({ items: [], scope: { kind: 'no_scope' } });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

describe('decideDayException', () => {
  const approvedHours = { regular: 8, overtime: 0, sunday: 0, holiday: 0, leave: 0, unpaid: 0 };
  const decision = { exceptionId: EXCEPTION_ID, expectedResultVersion: 4, action: 'approve' as const,
    approvedHours, reason: 'Confirmed against site close record', actor: SUPERVISOR };

  it('rejects a stale result version without writing a decision', async () => {
    const state = installTransaction({ version: 5 });
    await expect(decideDayException(decision)).rejects.toMatchObject({ code: 'result_stale' });
    expect(state.writes).toEqual([]);
  });

  it.each(['approved_leave', 'sick_leave', 'site_shutdown_weather', 'public_holiday', 'unauthorised_absence'] as const)(
    'persists the exact %s classification and read-back', async (classification) => {
      const state = installTransaction({
        kind: 'missing_clock_in', status: 'awaiting_supervisor',
        adjustments: new Map(), exceptionAdjustmentId: null,
      });
      const result = await decideDayException({ ...decision, action: 'classify', classification, approvedHours: undefined });
      expect(result.exception.status).toBe('resolved');
      expect(result.dailyResult.attendanceClassification).toBe(classification);
      expect(state.writes).toEqual(['summary', 'exception', 'sibling_version', 'event']);
    });

  it.each([
    ['Sunday', 'sunday_work', { regular: 0, overtime: 0, sunday: 5, holiday: 0, leave: 0, unpaid: 0 }],
    ['overtime', 'outside_schedule', { regular: 8, overtime: 2, sunday: 0, holiday: 0, leave: 0, unpaid: 0 }],
  ] as const)('approves %s hours', async (_label, kind, hours) => {
    installTransaction({ kind, adjustments: new Map(), exceptionAdjustmentId: null });
    const result = await decideDayException({ ...decision, approvedHours: hours });
    expect(result.dailyResult.approvedHours).toEqual(hours);
  });

  it('returns a correction to the worker while preserving its adjustment record', async () => {
    const state = installTransaction();
    const result = await decideDayException({ ...decision, action: 'return', approvedHours: undefined });
    expect(result.exception.status).toBe('awaiting_worker');
    expect(result.dailyResult.status).toBe('awaiting_worker');
    expect(state.adjustments.has(ADJUSTMENT_ID)).toBe(true);
    expect(state.adjustments.get(ADJUSTMENT_ID)).toBe('rejected');
    expect(state.exceptionAdjustmentId).toBeNull();
    expect(state.writes).toEqual(['summary', 'adjustment', 'exception', 'sibling_version', 'event']);
  });

  it('keeps the daily result awaiting_supervisor for an awaiting_worker sibling and advances its version', async () => {
    const state = installTransaction({ siblingStatus: 'awaiting_worker', siblingVersion: 4 });
    const result = await decideDayException(decision);
    expect(result.dailyResult.status).toBe('awaiting_supervisor');
    expect(state.siblingVersion).toBe(5);
    expect(state.siblingStatus).toBe('awaiting_worker');
    expect(state.writes).toContain('sibling_version');
  });

  it('returns IDOR-safe not_found for a foreign worker', async () => {
    const state = installTransaction({ staffId: STAFF_B });
    await expect(decideDayException(decision)).rejects.toMatchObject({ code: 'not_found' });
    expect(state.writes).toEqual([]);
  });

  it('rechecks current edit permission after acquiring the canonical week lock', async () => {
    const state = installTransaction();
    mocks.userHasPermission.mockResolvedValue(false);
    await expect(decideDayException(decision)).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.writes).toEqual([]);
    expect(mocks.acquireWeekLock).toHaveBeenCalledWith(expect.anything(), '2026-07-27');
    expect(mocks.acquireWeekLock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.userHasPermission.mock.invocationCallOrder[0]!,
    );
  });

  it('authorizes a site_supervisor through current permission and scope checks', async () => {
    const state = installTransaction({ currentRole: 'site_supervisor' });
    await expect(decideDayException(decision)).resolves.toMatchObject({
      exception: { status: 'resolved' },
    });
    expect(mocks.resolveScope).toHaveBeenCalledWith(expect.objectContaining({ role: 'site_supervisor' }));
    expect(state.committed).toBe(true);
  });

  it.each([
    [{ locked: true }, 'period_locked'],
    [{ status: 'resolved' as const }, 'already_decided'],
  ])('rejects locked/double decisions without writes', async (override, code) => {
    const state = installTransaction(override);
    await expect(decideDayException(decision)).rejects.toMatchObject({ code });
    expect(state.writes).toEqual([]);
  });

  it('rejects a non-physical approved total before opening a transaction', async () => {
    await expect(decideDayException({ ...decision, approvedHours: { ...approvedHours, regular: 20, overtime: 8 } }))
      .rejects.toMatchObject({ code: 'invalid_hours' } satisfies Partial<DayExceptionWorkflowError>);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rolls back daily, adjustment and exception writes when audit persistence fails', async () => {
    const state = installTransaction({ failEvent: true });
    await expect(decideDayException(decision)).rejects.toThrow('audit unavailable');
    expect(state.committed).toBe(false);
    expect(state.status).toBe('awaiting_supervisor');
    expect(state.version).toBe(4);
    expect(state.writes).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TxnClient } from '@/lib/db-pool';

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));

vi.mock('@/lib/db-pool', () => ({ query: mocks.query, transaction: mocks.transaction }));

import { AttendanceCorrectionError, submitMissingClockOutCorrection } from '../requiredActionQueries';

const EXCEPTION_ROW = {
  exception_id: 'exception-1',
  entry_id: 'entry-1',
  staff_id: 'staff-1',
  work_date: '2026-07-31',
  kind: 'missing_clock_out',
  status: 'awaiting_worker',
  adjustment_id: null,
  clock_in_at: '2026-07-31T06:00:00.000Z',
  clock_out_at: null,
  period_locked: false,
};

interface TxState {
  exception: typeof EXCEPTION_ROW;
  adjustment: null | {
    id: string; adjusted_clock_out_at: string; reason: string; status: 'pending';
  };
  eventId: string | null;
  failEvent: boolean;
  summaryRows: Array<{ result_status: string }>;
}

function installTransaction(initial: Partial<TxState> = {}): {
  state: TxState; committed: () => boolean; calls: Array<{ text: string; params: unknown[] }>;
} {
  const state: TxState = {
    exception: { ...EXCEPTION_ROW },
    adjustment: null,
    eventId: null,
    failEvent: false,
    summaryRows: [{ result_status: 'awaiting_supervisor' }],
    ...initial,
  };
  let didCommit = false;
  const calls: Array<{ text: string; params: unknown[] }> = [];

  const tx = {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (/pg_advisory_xact_lock/i.test(text)) return [{ acquired: '' }];
      if (/UPDATE attendance_daily_summaries/i.test(text)) return state.summaryRows;
      return [];
    }),
    queryOne: vi.fn(async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (/SELECT[\s\S]+FROM attendance_day_exceptions/i.test(text)) {
        return state.exception;
      }
      if (/SELECT[\s\S]+FROM attendance_adjustments/i.test(text)) {
        return state.adjustment;
      }
      if (/INSERT INTO attendance_adjustments/i.test(text)) {
        state.adjustment = {
          id: 'adjustment-1',
          adjusted_clock_out_at: '2026-07-31T15:00:00.000Z',
          reason: 'forgot during the vehicle handover',
          status: 'pending',
        };
        return { id: state.adjustment.id };
      }
      if (/UPDATE attendance_day_exceptions/i.test(text)) {
        state.exception = {
          ...state.exception,
          status: 'awaiting_supervisor',
          adjustment_id: 'adjustment-1',
        };
        return { id: state.exception.exception_id, status: state.exception.status };
      }
      if (/INSERT INTO attendance_decision_events/i.test(text)) {
        if (state.failEvent) throw new Error('decision event unavailable');
        state.eventId = 'event-1';
        return { id: state.eventId };
      }
      throw new Error(`Unexpected SQL in test: ${text}`);
    }),
    client: {},
  } as unknown as TxnClient;

  mocks.transaction.mockImplementation(async (callback: (client: TxnClient) => Promise<unknown>) => {
    const snapshot = structuredClone(state);
    try {
      const result = await callback(tx);
      didCommit = true;
      return result;
    } catch (error) {
      Object.assign(state, snapshot);
      throw error;
    }
  });

  return { state, committed: () => didCommit, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('submitMissingClockOutCorrection', () => {
  const submission = {
    staffId: 'staff-1',
    exceptionId: 'exception-1',
    adjustedClockOutAt: new Date('2026-07-31T15:00:00.000Z'),
    reason: 'forgot during the vehicle handover',
  };

  it('atomically creates one pending adjustment, advances state and records a decision event', async () => {
    const transaction = installTransaction();

    await expect(submitMissingClockOutCorrection(submission)).resolves.toEqual({
      adjustmentId: 'adjustment-1',
      exceptionId: 'exception-1',
      decisionEventId: 'event-1',
      exceptionStatus: 'awaiting_supervisor',
    });
    expect(transaction.committed()).toBe(true);
    expect(transaction.state.exception).toMatchObject({
      status: 'awaiting_supervisor',
      adjustment_id: 'adjustment-1',
    });
    expect(transaction.state.adjustment).toMatchObject({
      id: 'adjustment-1',
      status: 'pending',
    });
    expect(transaction.state.eventId).toBe('event-1');
    const preliminary = transaction.calls.findIndex(({ text }) =>
      /FROM attendance_day_exceptions/i.test(text) && !/FOR UPDATE OF de/i.test(text));
    const weekLock = transaction.calls.findIndex(({ text }) => /pg_advisory_xact_lock/i.test(text));
    const authoritative = transaction.calls.findIndex(({ text }) => /FOR UPDATE OF de/i.test(text));
    expect(preliminary).toBeLessThan(weekLock);
    expect(weekLock).toBeLessThan(authoritative);
  });

  it('returns an IDOR-safe not_found error for a foreign exception', async () => {
    installTransaction({ exception: null as unknown as typeof EXCEPTION_ROW });

    await expect(submitMissingClockOutCorrection(submission)).rejects.toMatchObject({
      code: 'not_found',
    } satisfies Partial<AttendanceCorrectionError>);
  });

  it('returns period_locked without inserting an adjustment', async () => {
    const transaction = installTransaction({
      exception: { ...EXCEPTION_ROW, period_locked: true },
    });

    await expect(submitMissingClockOutCorrection(submission)).rejects.toMatchObject({
      code: 'period_locked',
    } satisfies Partial<AttendanceCorrectionError>);
    expect(transaction.committed()).toBe(false);
    expect(transaction.state.adjustment).toBeNull();
    const weekLock = transaction.calls.findIndex(({ text }) => /pg_advisory_xact_lock/i.test(text));
    const authoritative = transaction.calls.findIndex(({ text }) => /FOR UPDATE OF de/i.test(text));
    expect(weekLock).toBeLessThan(authoritative);
  });

  it.each([
    ['no row', []],
    ['the wrong state', [{ result_status: 'awaiting_worker' }]],
    ['multiple rows', [{ result_status: 'awaiting_supervisor' }, { result_status: 'awaiting_supervisor' }]],
  ])('rolls back when the daily summary returns %s', async (_case, summaryRows) => {
    const transaction = installTransaction({ summaryRows });

    await expect(submitMissingClockOutCorrection(submission)).rejects.toThrow(
      'Attendance daily summary did not advance to awaiting_supervisor',
    );
    expect(transaction.committed()).toBe(false);
    expect(transaction.state.exception.status).toBe('awaiting_worker');
    expect(transaction.state.adjustment).toBeNull();
  });

  it('returns the existing pending adjustment for an identical retry', async () => {
    const transaction = installTransaction({
      exception: {
        ...EXCEPTION_ROW,
        status: 'awaiting_supervisor',
        adjustment_id: 'adjustment-1',
      },
      adjustment: {
        id: 'adjustment-1',
        adjusted_clock_out_at: '2026-07-31T15:00:00.000Z',
        reason: submission.reason,
        status: 'pending',
      },
      eventId: 'event-original',
    });

    await expect(submitMissingClockOutCorrection(submission)).resolves.toMatchObject({
      adjustmentId: 'adjustment-1',
      exceptionId: 'exception-1',
      exceptionStatus: 'awaiting_supervisor',
    });
    expect(transaction.state.adjustment?.id).toBe('adjustment-1');
  });

  it('returns an already-persisted identical retry even if the week was locked later', async () => {
    installTransaction({
      exception: {
        ...EXCEPTION_ROW,
        status: 'awaiting_supervisor',
        adjustment_id: 'adjustment-1',
        period_locked: true,
      },
      adjustment: {
        id: 'adjustment-1',
        adjusted_clock_out_at: '2026-07-31T15:00:00.000Z',
        reason: submission.reason,
        status: 'pending',
      },
    });

    await expect(submitMissingClockOutCorrection(submission)).resolves.toMatchObject({
      adjustmentId: 'adjustment-1',
      exceptionStatus: 'awaiting_supervisor',
    });
  });

  it('rejects a different second submission with a conflict', async () => {
    installTransaction({
      exception: {
        ...EXCEPTION_ROW,
        status: 'awaiting_supervisor',
        adjustment_id: 'adjustment-1',
      },
      adjustment: {
        id: 'adjustment-1',
        adjusted_clock_out_at: '2026-07-31T14:30:00.000Z',
        reason: 'a different claimed time',
        status: 'pending',
      },
    });

    await expect(submitMissingClockOutCorrection(submission)).rejects.toMatchObject({
      code: 'already_submitted',
    } satisfies Partial<AttendanceCorrectionError>);
  });

  it('rejects a claimed clock-out before the original clock-in', async () => {
    installTransaction();

    await expect(submitMissingClockOutCorrection({
      ...submission,
      adjustedClockOutAt: new Date('2026-07-31T05:59:00.000Z'),
    })).rejects.toMatchObject({ code: 'invalid_timestamp' } satisfies Partial<AttendanceCorrectionError>);
  });

  it('rejects a claimed clock-out on a different SAST work date', async () => {
    installTransaction();

    await expect(submitMissingClockOutCorrection({
      ...submission,
      adjustedClockOutAt: new Date('2026-08-01T06:00:00.000Z'),
    })).rejects.toMatchObject({ code: 'invalid_timestamp' } satisfies Partial<AttendanceCorrectionError>);
  });

  it('rejects correction when original clock-out evidence already exists', async () => {
    installTransaction({
      exception: { ...EXCEPTION_ROW, clock_out_at: '2026-07-31T15:00:00.000Z' },
    });

    await expect(submitMissingClockOutCorrection(submission)).rejects.toMatchObject({
      code: 'invalid_timestamp',
    } satisfies Partial<AttendanceCorrectionError>);
  });

  it('rejects an empty reason before opening a transaction', async () => {
    await expect(submitMissingClockOutCorrection({
      ...submission,
      reason: '   ',
    })).rejects.toMatchObject({ code: 'invalid_reason' } satisfies Partial<AttendanceCorrectionError>);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('does not commit the state transition when decision-event persistence fails', async () => {
    const transaction = installTransaction({ failEvent: true });

    await expect(submitMissingClockOutCorrection(submission)).rejects.toThrow('decision event unavailable');
    expect(transaction.committed()).toBe(false);
    expect(transaction.state.exception.status).toBe('awaiting_worker');
    expect(transaction.state.adjustment).toBeNull();
  });
});

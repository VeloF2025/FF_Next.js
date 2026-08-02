import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), transaction: vi.fn(), upsertProjection: vi.fn(), syncExceptions: vi.fn(),
}));
vi.mock('@/lib/db-pool', () => ({ query: mocks.query, transaction: mocks.transaction }));
vi.mock('../policy/projectionRepository', () => ({
  upsertDailyProjectionTxn: mocks.upsertProjection,
  syncDayExceptionsTxn: mocks.syncExceptions,
}));

import { MAX_JSON_PAYLOAD_BYTES } from '../policy/jsonPayloadValidation';
import {
  finishReconciliationRun,
  startReconciliationRun,
  systemCloseEntry,
  upsertSummary,
} from '../reconcileWriters';

const ENTRY = {
  id: '20000000-0000-4000-8000-000000000001',
  staff_id: '10000000-0000-4000-8000-000000000001',
  work_date: '2026-08-03',
  clock_in_at: '2026-08-03T06:00:00Z',
};
const RESULT = {
  workDate: ENTRY.work_date, scheduledPaidHours: 8, recordedElapsedHours: null,
  proposedRegularHours: 8, proposedOvertimeHours: 0, proposedSundayHours: 0,
  proposedHolidayHours: 0, leaveHours: 0, unpaidHours: 0,
  attendanceClassification: null, status: 'awaiting_worker' as const,
  exceptionKinds: ['missing_clock_out' as const], calculationFingerprint: 'fingerprint-1',
};

describe('attendance reconciliation writers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsertProjection.mockResolvedValue({ resultVersion: 1 });
    mocks.syncExceptions.mockResolvedValue(['exception-1']);
    mocks.transaction.mockImplementation(async (work) => work(unlockedTxn()));
  });

  it('operationally closes a session without manufacturing clock-out evidence', async () => {
    await expect(systemCloseEntry(ENTRY, 'policy-1', RESULT)).resolves.toBe(true);
    const tx = mocks.transaction.mock.calls[0] ? await transactionTxn() : null;
    const update = tx?.query.mock.calls.find((call) => /UPDATE attendance_entries/i.test(call[0]));
    const sql = String(update?.[0]);
    const params = update?.[1] as unknown[];
    expect(sql).toMatch(/status = 'auto_closed'/);
    expect(sql).toMatch(/system: attendance reconciliation operational closure/);
    expect(sql).toContain('work_date = $2::date');
    expect(sql).toContain("NOW() AT TIME ZONE 'Africa/Johannesburg'");
    expect(sql).toContain('FROM attendance_schedule_policies');
    expect(params).toEqual([ENTRY.id, ENTRY.work_date]);
    for (const evidenceColumn of [
      'clock_out_at',
      'client_occurred_at_out',
      'received_at_out',
      'selfie_out_url',
      'clock_out_lat',
      'clock_out_lon',
      'clock_out_accuracy_m',
    ]) {
      expect(sql).not.toMatch(new RegExp(`SET[\\s\\S]*${evidenceColumn}\\s*=`, 'i'));
    }
    expect(mocks.upsertProjection).toHaveBeenCalledWith(tx, expect.objectContaining({
      staffId: ENTRY.staff_id, policyId: 'policy-1', result: RESULT,
    }));
    expect(mocks.syncExceptions).toHaveBeenCalledWith(tx, expect.objectContaining({
      entryId: ENTRY.id, resultVersion: 1, result: RESULT,
    }));
  });

  it('does not auto-close raw evidence after the week becomes locked', async () => {
    const tx = unlockedTxn(true);
    mocks.transaction.mockImplementation(async (work) => work(tx));

    await expect(systemCloseEntry(ENTRY, 'policy-1', RESULT)).rejects.toMatchObject({ code: 'period_locked' });

    expect(tx.query.mock.calls.some((call) => /UPDATE attendance_entries/i.test(call[0]))).toBe(false);
  });

  it('keeps operational closure and its missing-clock-out blocker in one transaction', async () => {
    const tx = unlockedTxn();
    mocks.transaction.mockImplementation(async (work) => work(tx));
    mocks.syncExceptions.mockRejectedValueOnce(new Error('blocker unavailable'));

    await expect(systemCloseEntry(ENTRY, 'policy-1', RESULT)).rejects.toThrow('blocker unavailable');
    expect(tx.query.mock.calls.some((call) => /UPDATE attendance_entries/i.test(call[0]))).toBe(true);
    expect(mocks.syncExceptions).toHaveBeenCalledWith(tx, expect.objectContaining({
      entryId: ENTRY.id,
    }));
  });

  it('does not write the legacy shadow after the projected day becomes locked', async () => {
    const tx = unlockedTxn(false, 'locked');
    mocks.transaction.mockImplementation(async (work) => work(tx));

    await expect(upsertSummary(ENTRY.staff_id, ENTRY.work_date, {
      regularHrs: 8, overtimeHrs: 0, sundayHrs: 0, holidayHrs: 0, nightHrs: 0,
      incomplete: false, ruleId: 'rule-1', computationMode: 'bcea',
    })).rejects.toMatchObject({ code: 'period_locked' });

    expect(tx.query.mock.calls.some((call) => /INSERT INTO attendance_daily_summaries/i.test(call[0]))).toBe(false);
  });

  it('persists a running audit record before day work begins', async () => {
    mocks.query.mockResolvedValue([{ id: 'run-row' }]);

    await startReconciliationRun({
      runId: 'run-1',
      scannedFrom: '2026-08-03',
      scannedTo: '2026-08-03',
      startedAt: '2026-08-04T00:45:00.000Z',
    });

    expect(mocks.query.mock.calls[0]![0]).toMatch(/'running'/);
    expect(mocks.query.mock.calls[0]![1]).toEqual([
      'run-1',
      '2026-08-03',
      '2026-08-03',
      '{}',
      '[]',
      '2026-08-04T00:45:00.000Z',
    ]);
  });

  it('rejects oversized failed-day JSON before final audit SQL', async () => {
    const oversizedKey = 'x'.repeat(MAX_JSON_PAYLOAD_BYTES + 1);

    await expect(finishReconciliationRun({
      runId: 'run-1',
      schedulePolicyId: null,
      status: 'failed',
      counts: {
        systemClosed: 0,
        projectedDays: 0,
        unchangedDays: 0,
        skippedLockedDays: 0,
        missingClockOutExceptions: 0,
        missingClockInExceptions: 0,
      },
      failedDayKeys: [oversizedKey],
      finishedAt: '2026-08-04T00:46:00.000Z',
    })).rejects.toThrow(`JSON payload exceeds ${MAX_JSON_PAYLOAD_BYTES} bytes`);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

let lastTxn: ReturnType<typeof unlockedTxn> | null = null;
function unlockedTxn(activeLock = false, resultStatus = 'approved') {
  const tx = {
    query: vi.fn(async (text: string) => {
      if (/pg_advisory_xact_lock/i.test(text)) return [{ acquired: '' }];
      if (/UPDATE attendance_entries/i.test(text)) return [{ id: ENTRY.id }];
      return [];
    }),
    queryOne: vi.fn(async (text: string) => {
      if (/attendance_weekly_locks/i.test(text)) return { active_period_lock: activeLock };
      if (/SELECT result_status/i.test(text)) return { result_status: resultStatus };
      return null;
    }),
    client: {},
  };
  lastTxn = tx;
  return tx;
}
async function transactionTxn() { return lastTxn; }

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTRY_ID, POLICY, RULE, STAFF_ID, entry, expectedDay } from './reconcile.fixtures';

const mocks = vi.hoisted(() => ({
  finishRun: vi.fn(),
  loadDefaultRule: vi.fn(),
  loadEffectivePolicy: vi.fn(),
  loadEntries: vi.fn(),
  loadExpectedDays: vi.fn(),
  loadOpenEntries: vi.fn(),
  loadWeeklyOt: vi.fn(),
  logError: vi.fn(),
  persistDay: vi.fn(),
  startRun: vi.fn(),
  systemClose: vi.fn(),
  upsertSummary: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  log: { error: mocks.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../saPublicHolidays', () => ({
  loadObservedHolidays: vi.fn().mockResolvedValue(new Set<string>()),
  isHolidayDate: (date: string, holidays: Set<string>) => holidays.has(date),
  isSunday: (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0,
}));
vi.mock('../reconcileQueries', () => ({
  loadDefaultRule: mocks.loadDefaultRule,
  loadEffectivePolicy: mocks.loadEffectivePolicy,
  loadReconciliationEntries: mocks.loadEntries,
  loadExpectedAttendanceDays: mocks.loadExpectedDays,
  loadOpenEntriesForReconciliation: mocks.loadOpenEntries,
  loadPersistedWeeklyOtBefore: mocks.loadWeeklyOt,
}));
vi.mock('../reconcileWriters', () => ({
  finishReconciliationRun: mocks.finishRun,
  startReconciliationRun: mocks.startRun,
  systemCloseEntry: mocks.systemClose,
  upsertSummary: mocks.upsertSummary,
}));
vi.mock('../policy/projectionRepository', () => ({
  persistCalculatedDay: mocks.persistDay,
}));

import { reconcile } from '../reconcile';
describe('schedule-aware attendance reconciliation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T01:00:00.000Z'));
    vi.clearAllMocks();
    mocks.startRun.mockResolvedValue(undefined);
    mocks.finishRun.mockResolvedValue(undefined);
    mocks.loadEffectivePolicy.mockResolvedValue(POLICY);
    mocks.loadDefaultRule.mockResolvedValue(RULE);
    mocks.loadOpenEntries.mockResolvedValue([]);
    mocks.loadEntries.mockResolvedValue([]);
    mocks.loadExpectedDays.mockResolvedValue([]);
    mocks.loadWeeklyOt.mockResolvedValue(0);
    mocks.systemClose.mockResolvedValue(true);
    mocks.persistDay.mockResolvedValue({ resultVersion: 1, exceptionIds: [] });
    mocks.upsertSummary.mockResolvedValue(undefined);
  });

  afterEach(() => vi.useRealTimers());
  it('reconciles an old weekday open entry to an 8h awaiting-worker result', async () => {
    mocks.loadOpenEntries.mockResolvedValue([entry({ status: 'open' })]);
    mocks.loadEntries.mockResolvedValue([entry()]);
    mocks.loadExpectedDays.mockResolvedValue([expectedDay()]);
    mocks.persistDay.mockResolvedValue({ resultVersion: 1, exceptionIds: ['exception-1'] });

    const report = await reconcile({ fromDate: '2026-08-03', toDate: '2026-08-03' });

    expect(report.systemClosed).toBe(1);
    expect(report.missingClockOutExceptions).toBe(1);
    expect(mocks.persistDay).toHaveBeenCalledWith(expect.objectContaining({
      staffId: STAFF_ID,
      entryId: ENTRY_ID,
      result: expect.objectContaining({
        status: 'awaiting_worker',
        proposedRegularHours: 8,
      }),
    }));
  });

  it('does not report successful persistence when exception insert fails', async () => {
    mocks.loadEntries.mockResolvedValue([entry()]);
    mocks.loadExpectedDays.mockResolvedValue([expectedDay()]);
    mocks.persistDay.mockRejectedValueOnce(new Error('exception write failed'));

    const report = await reconcile({ fromDate: '2026-08-03', toDate: '2026-08-03' });

    expect(report.failedDayKeys).toEqual([`${STAFF_ID}:2026-08-03`]);
    expect(report.projectedDays).toBe(0);
    expect(report.missingClockOutExceptions).toBe(0);
    expect(mocks.finishRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('skips a locked prior week without poisoning an overlapping unlocked target week', async () => {
    mocks.loadEntries.mockResolvedValue([entry({ id: 'locked-entry', work_date: '2026-07-31',
      clock_in_at: '2026-07-31T06:00:00.000Z', clock_out_at: '2026-07-31T15:00:00.000Z' }),
    entry({ clock_out_at: '2026-08-03T15:00:00.000Z' })]);
    mocks.persistDay.mockRejectedValueOnce(Object.assign(new Error('locked'), { code: 'period_locked' }));
    const report = await reconcile({ fromDate: '2026-07-31', toDate: '2026-08-03' });
    expect(report).toMatchObject({ failedDayKeys: [], skippedLockedDays: 1, projectedDays: 1 });
    expect(mocks.startRun).toHaveBeenCalledWith(expect.objectContaining({ scannedFrom: '2026-07-31', scannedTo: '2026-08-03' }));
    expect(mocks.finishRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded', failedDayKeys: [],
      counts: expect.objectContaining({ skippedLockedDays: 1 }) }));
  });

  it('projects an expected no-entry weekday through the same day path', async () => {
    mocks.loadExpectedDays.mockResolvedValue([expectedDay()]);
    mocks.persistDay.mockResolvedValue({ resultVersion: 1, exceptionIds: ['exception-1'] });

    const report = await reconcile({ fromDate: '2026-08-03', toDate: '2026-08-03' });

    expect(report.projectedDays).toBe(1);
    expect(report.missingClockInExceptions).toBe(1);
    expect(mocks.persistDay).toHaveBeenCalledWith(expect.objectContaining({
      staffId: STAFF_ID,
      entryId: null,
      result: expect.objectContaining({ status: 'absence_review' }),
    }));
  });

  it('is replay-safe for identical evidence and reports the second result unchanged', async () => {
    mocks.loadEntries.mockResolvedValue([entry()]);
    mocks.loadExpectedDays.mockResolvedValue([expectedDay()]);
    const exceptionIds = new Set<string>();
    let storedFingerprint: string | null = null;
    let version = 0;
    mocks.persistDay.mockImplementation(async ({ result }: { result: { calculationFingerprint: string } }) => {
      if (storedFingerprint !== result.calculationFingerprint) {
        storedFingerprint = result.calculationFingerprint;
        version += 1;
      }
      exceptionIds.add(`${STAFF_ID}:2026-08-03:missing_clock_out`);
      return { resultVersion: version, exceptionIds: ['exception-1'] };
    });

    const first = await reconcile({ fromDate: '2026-08-03', toDate: '2026-08-03' });
    mocks.loadEntries.mockResolvedValue([
      entry({ calculation_fingerprint: storedFingerprint, result_version: version }),
    ]);
    const second = await reconcile({ fromDate: '2026-08-03', toDate: '2026-08-03' });
    const fingerprints = mocks.persistDay.mock.calls.map((call) =>
      call[0].result.calculationFingerprint as string
    );

    expect(first.projectedDays).toBe(1);
    expect(second.projectedDays).toBe(0);
    expect(second.unchangedDays).toBe(1);
    expect(exceptionIds.size).toBe(1);
    expect(version).toBe(1);
    expect(fingerprints[1]).toBe(fingerprints[0]);
  });

  it('processes legacy BCEA shadow writes in chronological order', async () => {
    mocks.loadEntries.mockResolvedValue([
      entry({
        work_date: '2026-08-04',
        clock_in_at: '2026-08-04T06:00:00.000Z',
        clock_out_at: '2026-08-04T15:00:00.000Z',
      }),
      entry({ id: 'entry-earlier', work_date: '2026-08-03', clock_out_at: '2026-08-03T15:00:00.000Z' }),
    ]);
    mocks.persistDay.mockResolvedValue({ resultVersion: 1, exceptionIds: [] });

    const report = await reconcile({ fromDate: '2026-08-03', toDate: '2026-08-04' });

    expect(mocks.logError.mock.calls).toEqual([]);
    expect(report.failedDayKeys).toEqual([]);
    expect(mocks.upsertSummary.mock.calls.map((call) => call[1])).toEqual([
      '2026-08-03',
      '2026-08-04',
    ]);
  });

  it('reloads the legacy weekly seed after a failed middle day', async () => {
    mocks.loadEntries.mockResolvedValue([
      entry({ clock_out_at: '2026-08-03T15:00:00.000Z' }),
      entry({
        id: 'entry-tuesday', work_date: '2026-08-04',
        clock_in_at: '2026-08-04T06:00:00.000Z', clock_out_at: '2026-08-04T15:00:00.000Z',
      }),
      entry({
        id: 'entry-wednesday', work_date: '2026-08-05',
        clock_in_at: '2026-08-05T06:00:00.000Z', clock_out_at: '2026-08-05T15:00:00.000Z',
      }),
    ]);
    mocks.loadWeeklyOt.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    mocks.persistDay
      .mockResolvedValueOnce({ resultVersion: 1, exceptionIds: [] })
      .mockRejectedValueOnce(new Error('Tuesday exception write failed'))
      .mockResolvedValueOnce({ resultVersion: 1, exceptionIds: [] });

    const report = await reconcile({ fromDate: '2026-08-03', toDate: '2026-08-05' });

    expect(report.failedDayKeys).toEqual([`${STAFF_ID}:2026-08-04`]);
    expect(mocks.loadWeeklyOt).toHaveBeenCalledTimes(2);
    expect(mocks.loadWeeklyOt.mock.calls[1]).toEqual([STAFF_ID, '2026-08-03', '2026-08-05']);
  });
  it('retains exact known day failures when a later run-level read aborts', async () => {
    mocks.loadOpenEntries.mockResolvedValue([entry({ status: 'open' })]);
    mocks.systemClose.mockRejectedValueOnce(new Error('closure failed'));
    mocks.loadEntries.mockRejectedValueOnce(new Error('entry reload failed'));

    await expect(reconcile({ fromDate: '2026-08-03', toDate: '2026-08-03' }))
      .rejects.toThrow('entry reload failed');

    expect(mocks.finishRun).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      failedDayKeys: [`${STAFF_ID}:2026-08-03`],
    }));
  });

  it('truncates an explicit current/future upper bound at yesterday SAST', async () => {
    await reconcile({ fromDate: '2026-08-03', toDate: '2026-08-05' });

    expect(mocks.loadOpenEntries).toHaveBeenCalledWith('2026-08-03', '2026-08-03');
    expect(mocks.loadEntries).toHaveBeenCalledWith('2026-08-03', '2026-08-03');
    expect(mocks.loadExpectedDays).toHaveBeenCalledWith('2026-08-03', '2026-08-03');
    expect(mocks.startRun).toHaveBeenCalledWith(expect.objectContaining({
      scannedFrom: '2026-08-03', scannedTo: '2026-08-03',
    }));
  });

  it('rejects a range that starts on the current/future SAST day before any write', async () => {
    await expect(reconcile({ fromDate: '2026-08-04', toDate: '2026-08-05' }))
      .rejects.toThrow(/must not be current or future in SAST/i);
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it('retains a successfully closed day if the projection reload aborts', async () => {
    mocks.loadOpenEntries.mockResolvedValue([entry({ status: 'open' })]);
    mocks.loadEntries.mockRejectedValueOnce(new Error('entry reload failed'));

    await expect(reconcile({ fromDate: '2026-08-03', toDate: '2026-08-03' }))
      .rejects.toThrow('entry reload failed');

    expect(mocks.finishRun).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      failedDayKeys: [`${STAFF_ID}:2026-08-03`],
    }));
  });
});

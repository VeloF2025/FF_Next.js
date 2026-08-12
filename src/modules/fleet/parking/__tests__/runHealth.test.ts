import { describe, expect, it } from 'vitest';
import { deriveParkingRunHealth, type ParkingRunRecord } from '../runHealth';

const row = (over: Partial<ParkingRunRecord> = {}): ParkingRunRecord => ({
  id: 'run-1', checkDate: '2026-08-10', startedAt: '2026-08-10T18:00:00.000Z',
  completedAt: '2026-08-10T18:05:00.000Z', status: 'succeeded', evaluatedCount: 20,
  violationCount: 1, recordErrorCount: 0, notificationWarningCount: 0, errorSummary: null,
  ...over,
});

describe('deriveParkingRunHealth', () => {
  it('keeps yesterday healthy before the 20:30 SAST grace boundary', () => {
    expect(deriveParkingRunHealth(row(), row(), new Date('2026-08-11T18:29:59Z')).state).toBe('healthy');
  });

  it('fails before grace when the most recent completion is older than yesterday', () => {
    expect(deriveParkingRunHealth(
      row({ checkDate: '2026-08-09' }),
      row({ checkDate: '2026-08-09' }),
      new Date('2026-08-11T08:00:00Z')
    )).toMatchObject({ state: 'failed', reason: 'Yesterday’s parking check has not completed' });
  });

  it('keeps today healthy when a later-started historical backfill is supplied as latest', () => {
    const today = row({ checkDate: '2026-08-11' });
    const backfill = row({ checkDate: '2026-08-01', startedAt: '2026-08-11T19:05:00Z' });

    expect(deriveParkingRunHealth(backfill, today, new Date('2026-08-11T19:10:00Z'))).toMatchObject({
      state: 'healthy',
      latestSuccessfulRun: today,
    });
  });

  it('fails when today has not completed at the grace boundary', () => {
    expect(deriveParkingRunHealth(row(), row(), new Date('2026-08-11T18:30:00Z'))).toMatchObject({ state: 'failed', reason: 'Today’s parking check has not completed' });
  });

  it('warns for a partial completion', () => {
    const partial = row({ checkDate: '2026-08-11', status: 'partial_failure' });
    expect(deriveParkingRunHealth(partial, partial, new Date('2026-08-11T19:00:00Z')).state).toBe('warning');
  });

  it('fails for a failed or stale running row', () => {
    expect(deriveParkingRunHealth(row({ status: 'failed' }), null, new Date('2026-08-11T19:00:00Z')).state).toBe('failed');
    expect(deriveParkingRunHealth(row({ status: 'running', startedAt: '2026-08-11T18:00:00Z', completedAt: null }), null, new Date('2026-08-11T18:16:00Z')).state).toBe('failed');
  });

  it('warns for a recent running row', () => {
    expect(deriveParkingRunHealth(row({ status: 'running', startedAt: '2026-08-11T18:00:00Z', completedAt: null }), null, new Date('2026-08-11T18:10:00Z')).state).toBe('warning');
  });

  it('explains missing history', () => {
    expect(deriveParkingRunHealth(null, null, new Date('2026-08-11T19:00:00Z'))).toMatchObject({ state: 'failed', reason: 'No parking check run has been recorded' });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { getSystemSyncStats } from '../qfieldSyncStatsRepo';

describe('getSystemSyncStats', () => {
  it('returns honestly system-scoped numeric aggregates', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'job-1',
          type: 'fiber_cables',
          status: 'syncing',
          started_at: '2026-01-24T12:00:00Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          last_completed_at: '2026-01-24T11:53:22Z',
          successful: '4',
          failed: '1',
          records_processed: '388',
          records_created: '2',
          records_updated: '385',
          records_failed: '1',
        },
      ])
      .mockResolvedValueOnce([{ count: '2' }]);

    await expect(getSystemSyncStats(run)).resolves.toEqual({
      scope: 'system',
      currentJob: {
        id: 'job-1',
        type: 'fiber_cables',
        status: 'syncing',
        startedAt: '2026-01-24T12:00:00Z',
      },
      lastCompletedAt: '2026-01-24T11:53:22Z',
      successful: 4,
      failed: 1,
      recordsProcessed: 388,
      recordsCreated: 2,
      recordsUpdated: 385,
      recordsFailed: 1,
      unresolvedConflicts: 2,
    });
  });

  it('uses three concurrent system queries with no fake project filter', async () => {
    let releaseCurrent: (rows: Record<string, unknown>[]) => void = () => undefined;
    const current = new Promise<Record<string, unknown>[]>((resolve) => {
      releaseCurrent = resolve;
    });
    const run = vi
      .fn()
      .mockImplementationOnce(() => current)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const pending = getSystemSyncStats(run);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3));
    expect(run.mock.calls.every(([, params]) => params === undefined)).toBe(true);
    expect(run.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/project_id|\$1/i);
    expect(run.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(
      /errors|qfield_value|fibreflow_value/i,
    );
    releaseCurrent([]);

    await expect(pending).resolves.toMatchObject({
      scope: 'system',
      currentJob: null,
      successful: 0,
      unresolvedConflicts: 0,
    });
  });
});

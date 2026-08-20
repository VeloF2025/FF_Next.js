import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: db.query, queryOne: db.queryOne }));

import {
  MonitorRunValidationError,
  findLatestMonitorRun,
  findStaleRunningRuns,
  finalizeMonitorRun,
  startMonitorRun,
} from '../runRepository';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const runRow = {
  id: RUN_ID, run_kind: 'status_monitor', requested_at: '2026-08-13T08:00:00.000Z', effective_at: '2026-08-13T08:00:00.000Z',
  status: 'running', roster_evaluated_count: 0, incidents_opened_count: 0, incidents_updated_count: 0,
  incidents_cleared_count: 0, notifications_accepted_count: 0, notifications_failed_count: 0,
  summaries_sent_count: 0, error_count: 0, error_summary: null, started_at: '2026-08-13T08:00:00.000Z', completed_at: null,
};

beforeEach(() => { vi.clearAllMocks(); });

describe('monitor run start/finalize', () => {
  it('starts a running run for a kind at the requested and effective instants', async () => {
    db.queryOne.mockResolvedValue(runRow);

    const run = await startMonitorRun('status_monitor', '2026-08-13T08:00:00.000Z', '2026-08-13T08:00:00.000Z');

    expect(run).toMatchObject({ id: RUN_ID, status: 'running', runKind: 'status_monitor' });
    expect(db.queryOne.mock.calls[0]?.[0]).toContain("'running'");
    expect(db.queryOne.mock.calls[0]?.[1]).toEqual(['status_monitor', '2026-08-13T08:00:00.000Z', '2026-08-13T08:00:00.000Z']);
  });

  it('finalizes a run as succeeded with counters', async () => {
    db.queryOne.mockResolvedValue({ ...runRow, status: 'succeeded', completed_at: '2026-08-13T08:05:00.000Z', roster_evaluated_count: 12 });

    const run = await finalizeMonitorRun(RUN_ID, { status: 'succeeded', rosterEvaluatedCount: 12 });

    expect(run).toMatchObject({ status: 'succeeded', rosterEvaluatedCount: 12, completedAt: '2026-08-13T08:05:00.000Z' });
    expect(db.queryOne.mock.calls[0]?.[0]).toContain('completed_at = now()');
  });

  it('finalizes a run as failed with a sanitized error summary', async () => {
    db.queryOne.mockResolvedValue({
      ...runRow, status: 'failed', error_summary: 'systemic evidence load failure', completed_at: '2026-08-13T08:05:00.000Z',
    });

    const run = await finalizeMonitorRun(RUN_ID, { status: 'failed', errorCount: 1, errorSummary: 'systemic evidence load failure' });

    expect(run.errorSummary).toBe('systemic evidence load failure');
    expect(run.status).toBe('failed');
  });

  it('finalizes a run as partial_failure', async () => {
    db.queryOne.mockResolvedValue({ ...runRow, status: 'partial_failure', completed_at: '2026-08-13T08:05:00.000Z', error_count: 1 });

    const run = await finalizeMonitorRun(RUN_ID, { status: 'partial_failure', errorCount: 1 });

    expect(run.status).toBe('partial_failure');
  });

  it('throws when finalizing a run that does not exist', async () => {
    db.queryOne.mockResolvedValue(null);

    await expect(finalizeMonitorRun(RUN_ID, { status: 'succeeded' })).rejects.toBeInstanceOf(MonitorRunValidationError);
  });
});

describe('monitor run health queries', () => {
  it('finds the latest run for a kind', async () => {
    db.queryOne.mockResolvedValue(runRow);

    await expect(findLatestMonitorRun('status_monitor')).resolves.toMatchObject({ id: RUN_ID });
    expect(db.queryOne.mock.calls[0]?.[0]).toContain('ORDER BY started_at DESC LIMIT 1');
    expect(db.queryOne.mock.calls[0]?.[1]).toEqual(['status_monitor']);
  });

  it('returns null when a kind has never run', async () => {
    db.queryOne.mockResolvedValue(null);

    await expect(findLatestMonitorRun('morning_summary')).resolves.toBeNull();
  });

  it('finds running runs started before a stale threshold', async () => {
    db.query.mockResolvedValue([runRow]);

    const runs = await findStaleRunningRuns('status_monitor', '2026-08-13T08:10:00.000Z');

    expect(runs).toMatchObject([{ id: RUN_ID }]);
    const [text, params] = db.query.mock.calls[0]!;
    expect(text).toContain("status = 'running'");
    expect(params).toEqual(['status_monitor', '2026-08-13T08:10:00.000Z']);
  });

  it('returns an empty list when no runs are stale', async () => {
    db.query.mockResolvedValue([]);

    await expect(findStaleRunningRuns('status_monitor', '2026-08-13T08:10:00.000Z')).resolves.toEqual([]);
  });
});

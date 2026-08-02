import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  poolConnect: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
  pool: { connect: mocks.poolConnect },
}));

import {
  createOrResumeRun,
  loadVelocityReviewControl,
  setVelocityReviewSummaryStatus,
  selectDueDates,
  withVelocityReviewLock,
} from '../runRepository';

describe('selectDueDates', () => {
  it('returns missing autonomous dates oldest first', () => {
    expect(selectDueDates({
      automationEnabled: true,
      goLiveDate: '2026-08-01',
      pilotEnabled: false,
      pilotTargetDate: null,
      pilotLimit: null,
    }, new Set(['2026-08-01']), '2026-08-03')).toEqual({
      status: 'ready',
      dates: ['2026-08-02', '2026-08-03'],
    });
  });

  it('blocks autonomous catch-up when the oldest gap is over seven days old', () => {
    expect(selectDueDates({
      automationEnabled: true,
      goLiveDate: '2026-07-01',
      pilotEnabled: false,
      pilotTargetDate: null,
      pilotLimit: null,
    }, new Set(), '2026-08-03')).toEqual({
      status: 'blocked',
      reason: 'gap_older_than_7_days',
    });
  });

  it('returns exactly the configured pilot date and limit', () => {
    expect(selectDueDates({
      automationEnabled: false,
      goLiveDate: null,
      pilotEnabled: true,
      pilotTargetDate: '2026-07-31',
      pilotLimit: 10,
    }, new Set(), '2026-08-03')).toEqual({
      status: 'pilot',
      dates: ['2026-07-31'],
      limit: 10,
    });
  });

  it('fails closed when autonomous and pilot controls are both enabled', () => {
    expect(selectDueDates({
      automationEnabled: true,
      goLiveDate: '2026-08-01',
      pilotEnabled: true,
      pilotTargetDate: '2026-08-01',
      pilotLimit: 10,
    }, new Set(), '2026-08-03')).toEqual({
      status: 'blocked',
      reason: 'invalid_control',
    });
  });
});

describe('run persistence and locking', () => {
  beforeEach(() => {
    mocks.query.mockReset().mockResolvedValue([]);
    mocks.queryOne.mockReset();
    mocks.poolConnect.mockReset();
  });

  it('maps the singleton control row to camel-case fields', async () => {
    mocks.queryOne.mockResolvedValue({
      automation_enabled: false,
      go_live_date: null,
      pilot_enabled: true,
      pilot_target_date: '2026-07-31',
      pilot_limit: 10,
    });

    await expect(loadVelocityReviewControl()).resolves.toEqual({
      automationEnabled: false,
      goLiveDate: null,
      pilotEnabled: true,
      pilotTargetDate: '2026-07-31',
      pilotLimit: 10,
    });
  });

  it('returns the canonical run when the target date already exists', async () => {
    mocks.queryOne.mockResolvedValue({
      id: 'run-1',
      target_date: '2026-08-01',
      status: 'complete',
      started_at: new Date('2026-08-02T07:00:00Z'),
      completed_at: new Date('2026-08-02T07:05:00Z'),
      counts: { completed: 2 },
      summary_status: 'sent',
    });

    await expect(createOrResumeRun('2026-08-01')).resolves.toMatchObject({
      id: 'run-1',
      targetDate: '2026-08-01',
      status: 'complete',
    });
    const [text, params] = mocks.queryOne.mock.calls[0] as [string, unknown[]];
    expect(text).toContain('ON CONFLICT (target_date) DO UPDATE');
    expect(params).toEqual(['2026-08-01']);
  });

  it('updates only summary status for the selected completed run dates', async () => {
    await setVelocityReviewSummaryStatus(['2026-07-30', '2026-07-31'], 'failed');

    const [text, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(text).toContain('UPDATE velocity_review_runs');
    expect(text).toContain('SET summary_status = $2');
    expect(text).not.toMatch(/\bstatus\s*=/);
    expect(text).not.toContain('velocity_review_exports');
    expect(params).toEqual([['2026-07-30', '2026-07-31'], 'failed']);
  });

  it('holds and always releases the dedicated advisory-lock connection', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [{ unlocked: true }] }),
      release: vi.fn(),
    };
    mocks.poolConnect.mockResolvedValue(client);

    await expect(withVelocityReviewLock(async () => 'worked')).resolves.toEqual({
      acquired: true,
      value: 'worked',
    });
    expect(client.query.mock.calls[0]?.[0]).toContain('pg_try_advisory_lock');
    expect(client.query.mock.calls[1]?.[0]).toContain('pg_advisory_unlock');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('does not run work when the advisory lock is unavailable', async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{ acquired: false }] }),
      release: vi.fn(),
    };
    mocks.poolConnect.mockResolvedValue(client);
    const work = vi.fn();

    await expect(withVelocityReviewLock(work)).resolves.toEqual({ acquired: false });
    expect(work).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('releases the dedicated connection when advisory unlock fails', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockRejectedValueOnce(new Error('unlock failed')),
      release: vi.fn(),
    };
    mocks.poolConnect.mockResolvedValue(client);

    await expect(withVelocityReviewLock(async () => 'worked')).rejects.toThrow('unlock failed');
    expect(client.release).toHaveBeenCalledOnce();
  });
});

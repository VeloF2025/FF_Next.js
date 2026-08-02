import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), notify: vi.fn(), readiness: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: mocks.query }));
vi.mock('@/modules/notifications/services/notificationBus', () => ({ notify: mocks.notify }));
vi.mock('../periodQueries', () => ({ getPeriodReadiness: mocks.readiness }));

import { runAttendanceNotifications } from '../notificationService';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue([]);
});

describe('SAST phase gates', () => {
  it.each([
    ['Sunday morning', 'morning', '2026-08-09T06:15:00Z'],
    ['Sunday clock-out', 'clockout', '2026-08-09T15:00:00Z'],
    ['weekday before 08:15', 'morning', '2026-08-03T06:14:00Z'],
    ['weekday before 17:00', 'clockout', '2026-08-03T14:59:00Z'],
    ['Saturday before 13:00', 'clockout', '2026-08-08T10:59:00Z'],
  ] as const)('skips %s without candidate reads', async (_label, phase, value) => {
    const report = await runAttendanceNotifications({ phase, now: new Date(value) });
    expect(report).toMatchObject({ examined: 0, claimed: 0, accepted: 0, failed: 0 });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it.each([
    ['weekday 17:00', '2026-08-03T15:00:00Z', '2026-08-03'],
    ['Saturday 13:00', '2026-08-08T11:00:00Z', '2026-08-08'],
  ] as const)('queries still-open sessions at %s using the SAST work date', async (_label, value, date) => {
    await runAttendanceNotifications({ phase: 'clockout', now: new Date(value) });
    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/status = 'open'/i);
    expect(sql).toMatch(/clock_out_at IS NULL/i);
    expect(params).toEqual([date]);
  });

  it('accepts Saturday morning correction reminders', async () => {
    const report = await runAttendanceNotifications({
      phase: 'morning', now: new Date('2026-08-08T06:15:00Z'),
    });
    const candidateSql = mocks.query.mock.calls[0]?.[0] as string;
    expect(candidateSql).toMatch(/status = 'awaiting_worker'/i);
    expect(candidateSql).toMatch(/kind = 'missing_clock_out'/i);
    expect(candidateSql).not.toMatch(/missing_clock_in/i);
    expect(candidateSql).toMatch(/adjustment_id IS NULL/i);
    expect(candidateSql).toMatch(/resolved_at IS NULL/i);
    expect(candidateSql).toMatch(/clock_out_at IS NULL/i);
    expect(candidateSql).toMatch(/ds\.result_version = de\.result_version/i);
    expect(report).toMatchObject({ examined: 0, claimed: 0, accepted: 0, failed: 0 });
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('rejects an invalid runtime phase before any query', async () => {
    await expect(runAttendanceNotifications({
      phase: 'later' as 'morning', now: new Date('2026-08-03T06:15:00Z'),
    })).rejects.toThrow('Unsupported attendance notification phase');
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

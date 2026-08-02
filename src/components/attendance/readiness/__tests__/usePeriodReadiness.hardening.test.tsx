/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePeriodReadiness, type WeeklyLockView } from '../usePeriodReadiness';

const WEEK_A = '2026-07-27';
const WEEK_B = '2026-07-20';
const readiness = (weekStartDate: string) => ({
  weekStartDate, weekEndDate: weekStartDate === WEEK_A ? '2026-08-02' : '2026-07-26',
  activeStaffCount: 2, expectedDayCount: 12, approvedDayCount: 12, blockerCount: 0,
  unapprovedOvertimeHours: 0, unapprovedSundayHours: 0,
  reconciliationLastSucceededAt: '2026-08-03T05:00:00.000Z',
  reconciliationFresh: true, readyToLock: true, blockers: [],
});

function lock(week: string, version: string | number | null,
  action: WeeklyLockView['latest_action'] = 'lock', reason = 'Close approved payroll weeks') {
  return {
    week_start_date: week, locked_at: '2026-08-03T06:00:00.000Z', locked_by: 'admin-1',
    lock_reason: reason, unlocked_at: null, unlocked_by: null, unlock_reason: null,
    lock_version: version, latest_action: action, latest_actor_user_id: 'admin-1',
    latest_reason: reason, latest_recorded_at: '2026-08-03T06:00:00.000Z',
  } satisfies WeeklyLockView;
}

const ok = (data: unknown): Response => (
  { ok: true, status: 200, json: async () => ({ success: true, data }) } as Response
);

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => vi.clearAllMocks());

describe('readiness request generation', () => {
  it('ignores week A readiness and exact-lock completions after switching to week B', async () => {
    const aReadiness = deferred<Response>();
    const aLock = deferred<Response>();
    global.fetch = vi.fn((input) => {
      const url = String(input);
      if (url.includes('attendance-period-readiness') && url.includes(WEEK_A)) return aReadiness.promise;
      if (url.includes('attendance-weekly-locks') && url.includes(WEEK_A)) return aLock.promise;
      if (url.includes('attendance-period-readiness') && url.includes(WEEK_B)) return Promise.resolve(ok(readiness(WEEK_B)));
      if (url.includes('attendance-weekly-locks') && url.includes(WEEK_B)) return Promise.resolve(ok({ lock: null }));
      throw new Error(`Unexpected fetch ${url}`);
    });
    const hook = renderHook(({ week }) => usePeriodReadiness(week), { initialProps: { week: WEEK_A } });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    hook.rerender({ week: WEEK_B });
    await waitFor(() => expect(hook.result.current.readiness?.weekStartDate).toBe(WEEK_B));

    await act(async () => {
      aReadiness.resolve(ok(readiness(WEEK_A)));
      aLock.resolve(ok({ lock: lock(WEEK_A, 9) }));
      await Promise.all([aReadiness.promise, aLock.promise]);
    });
    expect(hook.result.current.readiness?.weekStartDate).toBe(WEEK_B);
    expect(hook.result.current.lock).toBeNull();
  });

  it('invalidates an in-flight command on unmount before any readback or state completion', async () => {
    const post = deferred<Response>();
    global.fetch = vi.fn((input, init) => {
      const url = String(input);
      if (url.includes('attendance-period-readiness')) return Promise.resolve(ok(readiness(WEEK_A)));
      if (url.includes('attendance-weekly-locks') && init?.method === 'POST') return post.promise;
      if (url.includes('attendance-weekly-locks')) return Promise.resolve(ok({ lock: null }));
      throw new Error(`Unexpected fetch ${url}`);
    });
    const hook = renderHook(() => usePeriodReadiness(WEEK_A));
    await waitFor(() => expect(hook.result.current.readiness).not.toBeNull());
    let command: Promise<void> | undefined;
    act(() => { command = hook.result.current.lockWeek('Close approved payroll week'); });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));

    hook.unmount();
    await act(async () => {
      post.resolve(ok({ lock: { weekStartDate: WEEK_A, version: 1, active: true } }));
      await command;
    });

    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('does not publish an old success when the week changes during deferred readback', async () => {
    const oldReadiness = deferred<Response>();
    const oldLock = deferred<Response>();
    let aReadinessCalls = 0;
    let aLockReads = 0;
    global.fetch = vi.fn((input, init) => {
      const url = String(input);
      if (url.includes('attendance-period-readiness') && url.includes(WEEK_A)) {
        aReadinessCalls += 1;
        return aReadinessCalls === 1 ? Promise.resolve(ok(readiness(WEEK_A))) : oldReadiness.promise;
      }
      if (url.includes('attendance-weekly-locks') && init?.method === 'POST') {
        return Promise.resolve(ok({ lock: { weekStartDate: WEEK_A, version: 1, active: true } }));
      }
      if (url.includes('attendance-weekly-locks') && url.includes(WEEK_A)) {
        aLockReads += 1;
        return aLockReads === 1 ? Promise.resolve(ok({ lock: null })) : oldLock.promise;
      }
      if (url.includes('attendance-period-readiness') && url.includes(WEEK_B)) return Promise.resolve(ok(readiness(WEEK_B)));
      if (url.includes('attendance-weekly-locks') && url.includes(WEEK_B)) return Promise.resolve(ok({ lock: null }));
      throw new Error(`Unexpected fetch ${url}`);
    });
    const hook = renderHook(({ week }) => usePeriodReadiness(week), { initialProps: { week: WEEK_A } });
    await waitFor(() => expect(hook.result.current.readiness?.weekStartDate).toBe(WEEK_A));
    let command: Promise<void> | undefined;
    act(() => { command = hook.result.current.lockWeek('Close approved payroll week'); });
    await waitFor(() => expect(aReadinessCalls).toBe(2));

    hook.rerender({ week: WEEK_B });
    await waitFor(() => expect(hook.result.current.readiness?.weekStartDate).toBe(WEEK_B));
    await act(async () => {
      oldReadiness.resolve(ok({ ...readiness(WEEK_A), readyToLock: false }));
      oldLock.resolve(ok({ lock: lock(WEEK_A, 1) }));
      await command;
    });

    expect(hook.result.current.success).toBeNull();
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.lock).toBeNull();
  });
});

describe('bulk readback correlation', () => {
  it('relocks exact older versions even when they would fall outside the recent-list bound', async () => {
    const priorA = { ...lock(WEEK_A, 1, 'unlock'), unlocked_at: '2026-08-01T00:00:00Z' };
    priorA.lock_version = 207;
    const priorB = { ...lock(WEEK_B, 193, 'unlock'), unlocked_at: '2026-07-25T00:00:00Z' };
    let postSubmitted = false;
    global.fetch = vi.fn((input, init) => {
      const url = String(input);
      if (url.includes('attendance-bulk-lock') && init?.method === 'POST') {
        postSubmitted = true;
        return Promise.resolve(ok({ batch_id: 'batch-1', weeks: [WEEK_A, WEEK_B], locks_created: 2 }));
      }
      if (url.includes('attendance-period-readiness')) {
        const week = url.includes(WEEK_A) ? WEEK_A : WEEK_B;
        return Promise.resolve(ok({ ...readiness(week), readyToLock: !postSubmitted }));
      }
      if (url.includes('attendance-weekly-locks')) {
        const week = url.includes(WEEK_A) ? WEEK_A : WEEK_B;
        const prior = week === WEEK_A ? priorA : priorB;
        return Promise.resolve(ok({ lock: postSubmitted
          ? lock(week, week === WEEK_A ? 208 : 194, 'relock') : prior }));
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    const hook = renderHook(() => usePeriodReadiness(WEEK_A));
    await waitFor(() => expect(hook.result.current.readiness).not.toBeNull());
    await act(async () => { await hook.result.current.addBulkWeek(WEEK_B); });
    await act(async () => {
      await hook.result.current.bulkLock([WEEK_A, WEEK_B], 'Close approved payroll weeks');
    });
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.success).toMatch(/confirmed from server readback/i);
    const urls = vi.mocked(global.fetch).mock.calls.map(([input]) => String(input));
    expect(urls).not.toContain('/api/staff/attendance-weekly-locks?limit=200');
    expect(urls).toContain(`/api/staff/attendance-weekly-locks?week_start_date=${WEEK_A}`);
    expect(urls).toContain(`/api/staff/attendance-weekly-locks?week_start_date=${WEEK_B}`);
  });

  it.each([
    ['missing selected row', [lock(WEEK_A, 1)], []],
    ['legacy post row', [lock(WEEK_A, null), lock(WEEK_B, 1)], []],
    ['wrong latest action', [lock(WEEK_A, 1, 'unlock'), lock(WEEK_B, 1)], []],
    ['different audit reason', [lock(WEEK_A, 1, 'lock', 'Another close'), lock(WEEK_B, 1)], []],
    ['concurrent version jump', [lock(WEEK_A, 2), lock(WEEK_B, 1)], []],
    ['unlocked post-readback row', [{ ...lock(WEEK_A, 1), unlocked_at: '2026-08-03T07:00:00Z' }, lock(WEEK_B, 1)], []],
    ['legacy pre-submit version', [lock(WEEK_A, 1), lock(WEEK_B, 1)], [{ ...lock(WEEK_A, null), unlocked_at: '2026-08-01T00:00:00Z' }]],
  ])('fails closed for %s', async (_label, postLocks, preLocks) => {
    let postSubmitted = false;
    global.fetch = vi.fn((input, init) => {
      const url = String(input);
      if (url.includes('attendance-bulk-lock') && init?.method === 'POST') {
        postSubmitted = true;
        return Promise.resolve(ok({ batch_id: 'batch-1', weeks: [WEEK_A, WEEK_B], locks_created: 2 }));
      }
      if (url.includes('attendance-period-readiness')) {
        const week = url.includes(WEEK_A) ? WEEK_A : WEEK_B;
        return Promise.resolve(ok({ ...readiness(week), readyToLock: !postSubmitted }));
      }
      if (url.includes('attendance-weekly-locks')) {
        const week = url.includes(WEEK_A) ? WEEK_A : WEEK_B;
        const rows = postSubmitted ? postLocks : preLocks;
        return Promise.resolve(ok({ lock: rows.find((row) => row.week_start_date === week) ?? null }));
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    const hook = renderHook(() => usePeriodReadiness(WEEK_A));
    await waitFor(() => expect(hook.result.current.readiness).not.toBeNull());
    await act(async () => { await hook.result.current.addBulkWeek(WEEK_B); });
    await waitFor(() => expect(hook.result.current.bulkWeeks).toHaveLength(2));
    await act(async () => {
      await hook.result.current.bulkLock([WEEK_A, WEEK_B], 'Close approved payroll weeks');
    });

    expect(hook.result.current.success).toBeNull();
    expect(hook.result.current.error).not.toBeNull();
  });
});

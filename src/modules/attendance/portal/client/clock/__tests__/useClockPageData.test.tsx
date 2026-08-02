/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRouter } from 'next/router';

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), getCurrentAttendance: vi.fn() }));
vi.mock('../../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../api')>(),
  getSession: mocks.getSession,
}));
vi.mock('../../attendanceStateApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../attendanceStateApi')>(),
  getCurrentAttendance: mocks.getCurrentAttendance,
}));

import { ApiError } from '../../api';
import type { CurrentAttendanceResponse } from '../../attendanceStateApi';
import { useClockPageData } from '../useClockPageData';

const current: CurrentAttendanceResponse = {
  workDate: '2026-08-04', open: null,
  schedule: { policyId: 'policy-1', timezone: 'Africa/Johannesburg', start: '08:00', end: '17:00',
    unpaidBreakMinutes: 60, scheduledPaidHours: 8 },
  result: { status: 'awaiting_worker', recordedElapsedHours: null, scheduledPaidHours: 8 },
  requiredAttendanceAction: { exceptionId: 'exception-1', entryId: 'entry-1', workDate: '2026-08-03',
    kind: 'missing_clock_out', provisionalPaidHours: 8, clockInAt: '2026-08-03T06:00:00Z' },
};
const router = { replace: vi.fn() } as unknown as NextRouter;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-08-04T08:00:00+02:00'));
  vi.clearAllMocks();
  localStorage.clear();
  mocks.getSession.mockResolvedValue({
    session: { staffId: 'staff-1', sessionId: 'session-1', method: 'pin', expiresAt: '2026-08-04T10:00:00Z' },
    profile: null,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useClockPageData offline eligibility', () => {
  it('reuses the versioned unresolved-action state on a cold offline remount', async () => {
    mocks.getCurrentAttendance.mockResolvedValueOnce(current);
    const online = renderHook(() => useClockPageData(router));
    await waitFor(() => expect(online.result.current.attendance.status).toBe('ready'));
    online.unmount();

    mocks.getCurrentAttendance.mockRejectedValueOnce(
      new ApiError(0, 'NETWORK_ERROR', 'offline'),
    );
    const offline = renderHook(() => useClockPageData(router));
    await waitFor(() => expect(offline.result.current.attendance.status).toBe('ready'));
    expect(offline.result.current.attendance.data?.requiredAttendanceAction?.exceptionId)
      .toBe('exception-1');
  });

  it('fails closed offline when no current eligibility snapshot exists', async () => {
    mocks.getCurrentAttendance.mockRejectedValueOnce(
      new ApiError(0, 'NETWORK_ERROR', 'offline'),
    );
    const hook = renderHook(() => useClockPageData(router));
    await waitFor(() => expect(hook.result.current.attendance.status).toBe('error'));
    expect(hook.result.current.attendance.data).toBeNull();
  });

  it('does not hide a server rejection behind cached eligibility', async () => {
    mocks.getCurrentAttendance.mockResolvedValueOnce(current);
    const online = renderHook(() => useClockPageData(router));
    await waitFor(() => expect(online.result.current.attendance.status).toBe('ready'));
    online.unmount();
    mocks.getCurrentAttendance.mockRejectedValueOnce(new ApiError(500, 'SERVER_ERROR', 'bad'));

    const retry = renderHook(() => useClockPageData(router));
    await waitFor(() => expect(retry.result.current.attendance.status).toBe('error'));
  });
});

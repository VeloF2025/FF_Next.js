/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DayExceptionItem, DayExceptionListResult } from '@/modules/attendance/workflow/types';
import { useAttendanceActions } from '../useAttendanceActions';

vi.mock('next/router', () => ({
  useRouter: () => ({
    pathname: '/staff/attendance/corrections', query: {}, replace: vi.fn(),
  }),
}));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const exception: DayExceptionItem = {
  id: '11111111-1111-4111-8111-111111111111', staffId: 'staff-1', staffName: 'Thabo Mokoena',
  workDate: '2026-07-31', kind: 'late_arrival', status: 'awaiting_supervisor', resultVersion: 4,
  permittedActions: ['approve'],
  queueOwnerUserId: null, createdAt: '2026-08-01T06:00:00.000Z', crewName: 'Crew Bravo',
  site: { id: 'site-1', name: 'Midrand Core' },
  evidence: {
    entryId: 'entry-1', clockInAt: '2026-07-31T06:12:00.000Z',
    clockOutAt: '2026-07-31T15:00:00.000Z', clockInGpsAvailable: true,
    clockOutGpsAvailable: true, selfies: [],
  },
  adjustment: null,
  proposedHours: { regular: 7.8, overtime: 0, sunday: 0, holiday: 0 },
  dailyResult: {
    status: 'awaiting_supervisor', scheduledPaidHours: 8, recordedElapsedHours: 8.8,
    proposedHours: { regular: 7.8, overtime: 0, sunday: 0, holiday: 0, leave: 0, unpaid: 0 },
    approvedHours: null, attendanceClassification: null, blockingReasons: ['late_arrival'],
  },
};

const queue: DayExceptionListResult = {
  items: [exception], limit: 50, status: 'unresolved', scope: { kind: 'scoped', staffCount: 1 },
};
const ok = (data: unknown) => ({
  ok: true, status: 200, json: async () => ({ success: true, data }),
}) as Response;

beforeEach(() => { vi.clearAllMocks(); });

describe('useAttendanceActions submission lock', () => {
  it('blocks a second submit synchronously before busy state can rerender', async () => {
    const pendingPost = new Promise<Response>(() => undefined);
    global.fetch = vi.fn().mockResolvedValueOnce(ok(queue)).mockReturnValue(pendingPost);
    const { result } = renderHook(() => useAttendanceActions());
    await waitFor(() => expect(result.current.selected?.id).toBe(exception.id));

    act(() => {
      void result.current.submit(exception, { action: 'approve', reason: 'Reviewed once', approvedHours: exception.dailyResult.proposedHours });
      void result.current.submit(exception, { action: 'approve', reason: 'Reviewed twice', approvedHours: exception.dailyResult.proposedHours });
    });

    const postCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => (
      (init as RequestInit | undefined)?.method === 'POST'
    ));
    expect(postCalls).toHaveLength(1);
    expect(JSON.parse(String((postCalls[0][1] as RequestInit).body))).toMatchObject({
      reason: 'Reviewed once', expected_result_version: 4,
    });
  });
});

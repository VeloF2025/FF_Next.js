/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/attendance/AttendanceNav', () => ({ AttendanceNav: () => <nav>Attendance</nav> }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import StaffAttendanceWeekPage from '../../pages/staff/attendance/week';

const WEEK_A = '2026-07-27';
const WEEK_B = '2026-07-20';
const ready = (weekStartDate: string) => ({
  weekStartDate, weekEndDate: weekStartDate === WEEK_A ? '2026-08-02' : '2026-07-26',
  activeStaffCount: 1, expectedDayCount: 6, approvedDayCount: 6, blockerCount: 0,
  unapprovedOvertimeHours: 0, unapprovedSundayHours: 0,
  reconciliationLastSucceededAt: '2026-08-03T05:00:00Z', reconciliationFresh: true,
  readyToLock: false, blockers: [],
});
const weekData = (weekStart: string, regularHrs: number) => ({
  weekStart, weekEnd: weekStart === WEEK_A ? '2026-08-02' : '2026-07-26', staff: [],
  totals: { regularHrs: 99, overtimeHrs: 88, sundayHrs: 77, holidayHrs: 0,
    nightHrs: 0, exceptionsCount: 0, staffCount: 1 },
  payrollTotals: {
    regularHrs,
    overtimeHrs: 1.5,
    sundayHrs: 2,
    holidayHrs: 0,
    leaveHrs: 0,
    unpaidHrs: 0,
  },
  lock: null,
});
const lock = (week: string, version: unknown) => ({
  week_start_date: week, locked_at: '2026-08-03T06:00:00Z', locked_by: 'admin-1',
  lock_reason: 'Payroll close', unlocked_at: null, unlocked_by: null, unlock_reason: null,
  lock_version: version, latest_action: 'lock', latest_actor_user_id: 'admin-1',
  latest_reason: 'Payroll close', latest_recorded_at: '2026-08-03T06:00:00Z',
});
const ok = (data: unknown): Response => (
  { ok: true, status: 200, json: async () => ({ success: true, data }) } as Response
);
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => vi.clearAllMocks());

describe('weekly approved snapshot authority', () => {
  it.each([null, 0, 'NaN', 1.5])('fails closed for non-positive-integer lock version %s', async (version) => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(ok(weekData(WEEK_A, 12.5)))
      .mockResolvedValueOnce(ok(ready(WEEK_A)))
      .mockResolvedValueOnce(ok({ lock: lock(WEEK_A, version) }));
    render(<StaffAttendanceWeekPage />);
    expect(await screen.findByText('12.5h')).toBeVisible();
    expect(screen.getByText(/approved regular/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: /^csv$/i })).not.toBeInTheDocument();
  });

  it('ignores stale week and exact-lock completions after the selected Monday changes', async () => {
    const aWeek = deferred<Response>(); const aReadiness = deferred<Response>(); const aLock = deferred<Response>();
    global.fetch = vi.fn((input) => {
      const url = String(input);
      if (url.includes(`attendance-week?week_start=${WEEK_A}`)) return aWeek.promise;
      if (url.includes('attendance-period-readiness') && url.includes(WEEK_A)) return aReadiness.promise;
      if (url.includes('attendance-weekly-locks') && url.includes(WEEK_A)) return aLock.promise;
      if (url.includes(`attendance-week?week_start=${WEEK_B}`)) return Promise.resolve(ok(weekData(WEEK_B, 20)));
      if (url.includes('attendance-period-readiness') && url.includes(WEEK_B)) return Promise.resolve(ok(ready(WEEK_B)));
      if (url.includes('attendance-weekly-locks') && url.includes(WEEK_B)) return Promise.resolve(ok({ lock: null }));
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<StaffAttendanceWeekPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
    fireEvent.change(screen.getByLabelText(/week-start/i), { target: { value: WEEK_B } });
    expect(await screen.findByText('20.0h')).toBeVisible();

    aWeek.resolve(ok(weekData(WEEK_A, 91))); aReadiness.resolve(ok(ready(WEEK_A)));
    aLock.resolve(ok({ lock: lock(WEEK_A, 8) }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(6));
    expect(screen.getByText('20.0h')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^csv$/i })).not.toBeInTheDocument();
  });
});

/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  router: {
    pathname: '/staff/attendance/locks', asPath: '/staff/attendance/locks',
    query: {} as Record<string, string>, replace: vi.fn(), push: vi.fn(),
  },
  role: 'admin',
  canCreate: true,
  canEdit: true,
}));

vi.mock('next/router', () => ({ useRouter: () => mocks.router }));
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div data-testid="app-layout">{children}</div>,
}));
vi.mock('@/components/attendance/AttendanceNav', () => ({
  AttendanceNav: () => <nav aria-label="Pulse navigation">Locks</nav>,
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ currentUser: { role: mocks.role } }) }));
vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({
    can: (_key: string, action: string) => action === 'create' ? mocks.canCreate : mocks.canEdit,
    isLoading: false,
  }),
  useCanDo: (_key: string, action: string) => action === 'create' ? mocks.canCreate : mocks.canEdit,
}));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import StaffAttendanceLocksPage from '../../pages/staff/attendance/locks';
import StaffAttendanceWeekPage from '../../pages/staff/attendance/week';

const ready = {
  weekStartDate: '2026-07-27', weekEndDate: '2026-08-02', activeStaffCount: 2,
  expectedDayCount: 12, approvedDayCount: 12, blockerCount: 0,
  unapprovedOvertimeHours: 0, unapprovedSundayHours: 0,
  reconciliationLastSucceededAt: '2026-08-03T05:00:00.000Z',
  reconciliationFresh: true, readyToLock: true, blockers: [],
};

const blocked = {
  ...ready, readyToLock: false, approvedDayCount: 10, blockerCount: 2,
  unapprovedOvertimeHours: 2.5, unapprovedSundayHours: 5,
  blockers: [
    { staffId: 'staff-1', workDate: '2026-07-28', kind: 'awaiting_worker', owner: 'worker',
      actionUrl: '/my/attendance/corrections/new?exception_id=worker-ex', exceptionId: 'worker-ex',
      exceptionKind: 'missing_clock_out', status: 'awaiting_worker' },
    { staffId: 'staff-2', workDate: '2026-07-29', kind: 'awaiting_supervisor', owner: 'supervisor',
      actionUrl: '/staff/attendance/corrections?exception_id=supervisor-ex', exceptionId: 'supervisor-ex',
      exceptionKind: 'sunday_work', status: 'awaiting_supervisor' },
  ],
};

const lock = {
  week_start_date: ready.weekStartDate, locked_at: '2026-08-03T06:00:00.000Z',
  locked_by: 'admin-1', lock_reason: 'Approved payroll close', unlocked_at: null,
  unlocked_by: null, unlock_reason: null, lock_version: 1, latest_action: 'lock',
  latest_actor_user_id: 'admin-1', latest_reason: 'Approved payroll close',
  latest_recorded_at: '2026-08-03T06:00:00.000Z',
};

function ok(data: unknown): Response {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) } as Response;
}

function fail(status: number, message: string, reason?: string): Response {
  return { ok: false, status, json: async () => ({ success: false, error: { message, details: { reason } } }) } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.router.query = { week: ready.weekStartDate };
  mocks.router.asPath = `/staff/attendance/locks?week=${ready.weekStartDate}`;
  mocks.role = 'admin';
  mocks.canCreate = true;
  mocks.canEdit = true;
});

describe('HR attendance readiness and lock page', () => {
  it('rejects an invalid selected week without making a misleading API request', async () => {
    mocks.router.query = { week: '2026-07-28' };
    global.fetch = vi.fn();
    render(<StaffAttendanceLocksPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/must be a monday/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('distinguishes loading and API failure from an empty week', async () => {
    let reject: (reason: Error) => void = () => undefined;
    global.fetch = vi.fn().mockImplementation(() => new Promise((_resolve, rejected) => { reject = rejected; }));
    render(<StaffAttendanceLocksPage />);
    expect(screen.getByText(/loading period readiness/i)).toBeVisible();
    reject(new Error('Readiness unavailable'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Readiness unavailable');
    expect(screen.queryByText(/no expected attendance days/i)).not.toBeInTheDocument();
  });

  it('shows exact readiness counts, freshness and blocker owner/action links', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(ok(blocked))
      .mockResolvedValueOnce(ok({ lock: null }));
    render(<StaffAttendanceLocksPage />);

    expect(await screen.findByTestId('readiness-summary')).toBeVisible();
    expect(within(screen.getByTestId('readiness-expected')).getByText('12')).toBeVisible();
    expect(within(screen.getByTestId('readiness-approved')).getByText('10')).toBeVisible();
    expect(within(screen.getByTestId('readiness-blockers')).getByText('2')).toBeVisible();
    expect(screen.getByText(/reconciled/i)).toBeVisible();
    expect(screen.getByRole('link', { name: /worker action/i })).toHaveAttribute(
      'href', '/my/attendance/corrections/new?exception_id=worker-ex'
    );
    expect(screen.getByRole('link', { name: /supervisor action/i })).toHaveAttribute(
      'href', '/staff/attendance/corrections?exception_id=supervisor-ex'
    );
  });

  it('shows empty-week and stale-reconciliation reasons from server state', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(ok({ ...ready, expectedDayCount: 0, approvedDayCount: 0, readyToLock: false,
        reconciliationFresh: false, reconciliationLastSucceededAt: null }))
      .mockResolvedValueOnce(ok({ lock: null }));
    render(<StaffAttendanceLocksPage />);
    expect(await screen.findByText(/no expected attendance days/i)).toBeVisible();
    expect(screen.getByText(/reconciliation is stale/i)).toBeVisible();
  });

  it('keeps controls read-only for users outside admin and super-admin', async () => {
    mocks.role = 'project_manager';
    global.fetch = vi.fn()
      .mockResolvedValueOnce(ok(ready))
      .mockResolvedValueOnce(ok({ lock: null }));
    render(<StaffAttendanceLocksPage />);
    expect(await screen.findByTestId('lock-read-only')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^lock week/i })).not.toBeInTheDocument();
  });

  it('shows success only after lock POST and exact active-lock readback', async () => {
    const user = userEvent.setup();
    let resolvePost: (response: Response) => void = () => undefined;
    const post = new Promise<Response>((resolve) => { resolvePost = resolve; });
    global.fetch = vi.fn()
      .mockResolvedValueOnce(ok(ready))
      .mockResolvedValueOnce(ok({ lock: null }))
      .mockReturnValueOnce(post)
      .mockResolvedValueOnce(ok({ ...ready, readyToLock: false }))
      .mockResolvedValueOnce(ok({ lock }));
    render(<StaffAttendanceLocksPage />);
    await user.type(await screen.findByLabelText(/^lock reason/i), 'Approved payroll close');
    const button = screen.getByRole('button', { name: /^lock week/i });
    await user.click(button);
    await user.click(button);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(screen.queryByTestId('lock-success')).not.toBeInTheDocument();

    resolvePost(ok({ lock: {
      weekStartDate: ready.weekStartDate, version: 1, active: true,
      lockedAt: lock.locked_at, lockedBy: lock.locked_by, lockReason: lock.lock_reason,
      unlockedAt: null, unlockedBy: null, unlockReason: null,
    } }));
    expect(await screen.findByTestId('lock-success')).toHaveTextContent(/saved and confirmed/i);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(5));
  });

  it('retains the reason and refreshes current state after a concurrent 409', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn()
      .mockResolvedValueOnce(ok(ready))
      .mockResolvedValueOnce(ok({ lock: null }))
      .mockResolvedValueOnce(fail(409, 'Attendance period changed', 'period_has_blockers'))
      .mockResolvedValueOnce(ok(blocked))
      .mockResolvedValueOnce(ok({ lock: null }));
    render(<StaffAttendanceLocksPage />);
    await user.type(await screen.findByLabelText(/^lock reason/i), 'Approved payroll close');
    await user.click(screen.getByRole('button', { name: /^lock week/i }));

    expect(await screen.findByTestId('lock-stale')).toHaveTextContent(/changed before the lock was saved/i);
    expect(screen.getByLabelText(/^lock reason/i)).toHaveValue('Approved payroll close');
    expect(global.fetch).toHaveBeenCalledTimes(5);
    expect(screen.queryByTestId('lock-success')).not.toBeInTheDocument();
  });

  it('refreshes every selected week after an atomic bulk 409 and retains the reason', async () => {
    const user = userEvent.setup();
    const secondReady = { ...ready, weekStartDate: '2026-07-20', weekEndDate: '2026-07-26' };
    const secondBlocked = { ...secondReady, readyToLock: false, blockerCount: 1 };
    global.fetch = vi.fn()
      .mockResolvedValueOnce(ok(ready))
      .mockResolvedValueOnce(ok({ lock: null }))
      .mockResolvedValueOnce(ok(secondReady))
      .mockResolvedValueOnce(ok({ lock: null }))
      .mockResolvedValueOnce(fail(409, 'One selected week changed', 'period_has_blockers'))
      .mockResolvedValueOnce(ok(ready))
      .mockResolvedValueOnce(ok({ lock: null }))
      .mockResolvedValueOnce(ok(secondBlocked))
      .mockResolvedValueOnce(ok({ lock: null }));
    render(<StaffAttendanceLocksPage />);
    await screen.findByTestId('readiness-summary');
    fireEvent.change(screen.getByLabelText(/add payroll week/i), { target: { value: secondReady.weekStartDate } });
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    expect(await screen.findByText(`${secondReady.weekStartDate} · Ready`)).toBeVisible();
    await user.type(screen.getByLabelText(/bulk lock reason/i), 'Close both approved payroll weeks');
    await user.click(screen.getByRole('button', { name: /lock selected weeks/i }));

    expect(await screen.findByTestId('lock-stale')).toBeVisible();
    expect(screen.getByText(`${secondReady.weekStartDate} · Not ready`)).toBeVisible();
    expect(screen.getByLabelText(/bulk lock reason/i)).toHaveValue('Close both approved payroll weeks');
    expect(screen.queryByTestId('lock-success')).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(9);
  });
});

describe('weekly attendance locked-hour categories', () => {
  const weekData = {
    weekStart: ready.weekStartDate, weekEnd: ready.weekEndDate, staff: [],
    totals: { regularHrs: 80, overtimeHrs: 4, sundayHrs: 5, holidayHrs: 0,
      nightHrs: 0, exceptionsCount: 0, staffCount: 2 },
    payrollTotals: {
      regularHrs: 72,
      overtimeHrs: 2,
      sundayHrs: 5,
      holidayHrs: 0,
      leaveHrs: 0,
      unpaidHrs: 0,
    },
  };

  it('hides export navigation until the selected week has an active locked version', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(ok({ ...weekData, lock: null }))
      .mockResolvedValueOnce(ok(ready))
      .mockResolvedValueOnce(ok({ lock: null }));
    render(<StaffAttendanceWeekPage />);
    expect(await screen.findByText(/approved regular/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: /^csv$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^xlsx$/i })).not.toBeInTheDocument();
  });

  it('labels locked regular, overtime and Sunday categories and exposes the active version', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(ok({ ...weekData, lock: {
        version: lock.lock_version,
        lockedAt: lock.locked_at,
        lockedBy: lock.locked_by,
        reason: lock.lock_reason,
      } }))
      .mockResolvedValueOnce(ok({ ...ready, readyToLock: false }))
      .mockResolvedValueOnce(ok({ lock }));
    render(<StaffAttendanceWeekPage />);
    expect(await screen.findByText(/locked regular/i)).toBeVisible();
    expect(screen.getByText(/locked overtime/i)).toBeVisible();
    expect(screen.getByText(/locked sunday/i)).toBeVisible();
    expect(screen.getByText(/locked holiday/i)).toBeVisible();
    expect(screen.getByText(/locked leave/i)).toBeVisible();
    expect(screen.getByText(/locked unpaid/i)).toBeVisible();
    expect(screen.getByText(/lock version 1/i)).toBeVisible();
    expect(screen.getByRole('button', { name: /^csv$/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /^xlsx$/i })).toBeVisible();
  });
});

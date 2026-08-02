/** @vitest-environment jsdom */
import React, { act } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { currentAttendance, session } from './attendancePageFixtures';

const mocks = vi.hoisted(() => ({
  router: { query: {} as Record<string, string>, push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  getSession: vi.fn(), getCurrentAttendance: vi.fn(),
}));

vi.mock('next/router', () => ({ useRouter: () => mocks.router }));
vi.mock('@/modules/attendance/portal/client/api', async () => ({
  ...await vi.importActual<typeof import('@/modules/attendance/portal/client/api')>('@/modules/attendance/portal/client/api'),
  getSession: mocks.getSession,
}));
vi.mock('@/modules/attendance/portal/client/attendanceStateApi', async () => ({
  ...await vi.importActual<typeof import('@/modules/attendance/portal/client/attendanceStateApi')>('@/modules/attendance/portal/client/attendanceStateApi'),
  getCurrentAttendance: mocks.getCurrentAttendance,
}));
vi.mock('@/modules/attendance/portal/client/MyPortalShell', () => ({
  MyPortalShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/modules/fleet/offline/gpsCapture', () => ({
  captureGPSWithFallback: vi.fn(), queryGeolocationPermission: vi.fn().mockResolvedValue('prompt'),
}));
vi.mock('@/modules/attendance/portal/client/offline/useAttendanceSync', () => ({
  useAttendanceSync: () => ({ online: true, pendingCount: 0, syncing: false, queueUnavailable: false, syncNow: vi.fn(), refreshPendingCount: vi.fn() }),
}));
vi.mock('@/modules/attendance/portal/client/useDeviceFingerprint', () => ({ useDeviceFingerprint: () => null }));

import MyClockPage from '../../pages/my/attendance/clock';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.router.query = {};
  mocks.getSession.mockResolvedValue(session);
  mocks.getCurrentAttendance.mockResolvedValue(currentAttendance());
});

describe('server-derived clock schedule states', () => {
  it('shows the clean weekday schedule before clock-in', async () => {
    render(<MyClockPage />);
    expect(await screen.findByText('08:00–17:00')).toBeVisible();
    expect(screen.getByText('1h unpaid lunch')).toBeVisible();
    expect(screen.getByText('8h scheduled paid')).toBeVisible();
  });

  it('shows the short Saturday schedule from the server', async () => {
    mocks.getCurrentAttendance.mockResolvedValue(currentAttendance({
      schedule: { policyId: 'policy-1', timezone: 'Africa/Johannesburg', start: '08:00', end: '13:00', unpaidBreakMinutes: 0, scheduledPaidHours: 5 },
      result: { status: 'expected', recordedElapsedHours: null, scheduledPaidHours: 5 },
    }));
    render(<MyClockPage />);
    expect(await screen.findByText('08:00–13:00')).toBeVisible();
    expect(screen.getByText('5h scheduled paid')).toBeVisible();
    expect(screen.queryByText(/unpaid lunch/i)).not.toBeInTheDocument();
  });

  it('shows a server-derived Sunday rest day without inventing a shift', async () => {
    mocks.getCurrentAttendance.mockResolvedValue(currentAttendance({
      schedule: { policyId: 'policy-1', timezone: 'Africa/Johannesburg', start: null, end: null, unpaidBreakMinutes: 0, scheduledPaidHours: 0 },
      result: { status: 'expected', recordedElapsedHours: null, scheduledPaidHours: 0 },
    }));
    render(<MyClockPage />);
    expect(await screen.findByText('No scheduled shift')).toBeVisible();
    expect(screen.getByText('0h scheduled paid')).toBeVisible();
  });

  it('keeps controls hidden while current attendance is loading', async () => {
    let resolveCurrent: (value: unknown) => void = () => {};
    mocks.getCurrentAttendance.mockReturnValue(new Promise((resolve) => { resolveCurrent = resolve; }));
    render(<MyClockPage />);
    expect(screen.getByText('Loading schedule…')).toBeVisible();
    expect(screen.queryByText(/tap to take selfie/i)).not.toBeInTheDocument();
    await act(async () => resolveCurrent(currentAttendance()));
    expect(await screen.findByText('08:00–17:00')).toBeVisible();
  });

  it('shows an explicit retry and no controls when current API fails', async () => {
    mocks.getCurrentAttendance.mockRejectedValue(new Error('unavailable'));
    render(<MyClockPage />);
    expect(await screen.findByRole('alert', { name: /schedule unavailable/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /retry attendance/i })).toBeVisible();
    expect(screen.queryByText(/tap to take selfie/i)).not.toBeInTheDocument();
  });

  it('fails closed when session verification fails', async () => {
    mocks.getSession.mockRejectedValue(new Error('session unavailable'));
    render(<MyClockPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/verify your session/i);
    expect(screen.queryByText(/tap to take selfie/i)).not.toBeInTheDocument();
  });

  it('fails closed on an unknown persisted daily result status', async () => {
    mocks.getCurrentAttendance.mockResolvedValue(currentAttendance({
      result: { status: 'unexpected_state', recordedElapsedHours: null, scheduledPaidHours: 8 },
    }));
    render(<MyClockPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/attendance status unavailable/i);
    expect(screen.queryByText(/tap to take selfie/i)).not.toBeInTheDocument();
  });

  it('shows active and completed recorded states', async () => {
    mocks.getCurrentAttendance.mockResolvedValueOnce(currentAttendance({
      open: { entryId: 'open-1', workDate: '2026-08-04', clockInAt: '2026-08-04T06:00:00.000Z', siteGeofenceId: null, vehicleAssignmentId: null, selfieInUrl: null },
      result: { status: 'open', recordedElapsedHours: null, scheduledPaidHours: 8 },
    }));
    const { unmount } = render(<MyClockPage />);
    expect(await screen.findByText(/active shift/i)).toBeVisible();
    expect(screen.getByText(/clocked in 08:00/i)).toBeVisible();
    unmount();
    mocks.getCurrentAttendance.mockResolvedValueOnce(currentAttendance({
      result: { status: 'complete', recordedElapsedHours: 8.25, scheduledPaidHours: 8 },
    }));
    render(<MyClockPage />);
    expect(await screen.findByText('8.25h recorded')).toBeVisible();
  });

  it('uses persisted result scheduled hours for completed comparison', async () => {
    mocks.getCurrentAttendance.mockResolvedValue(currentAttendance({
      result: { status: 'complete', recordedElapsedHours: 7.25, scheduledPaidHours: 7.5 },
    }));
    render(<MyClockPage />);
    expect(await screen.findByText('7.25h recorded')).toBeVisible();
    expect(screen.getByText('7.5h scheduled paid')).toBeVisible();
    expect(screen.queryByText('8h scheduled paid')).not.toBeInTheDocument();
  });
});

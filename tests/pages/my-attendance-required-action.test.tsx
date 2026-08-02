/** @vitest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { currentAttendance, history, profile, requiredAction, session } from './attendancePageFixtures';

const mocks = vi.hoisted(() => ({
  router: { query: {} as Record<string, string>, pathname: '/my', push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  getSession: vi.fn(), getHistory: vi.fn(), getHubSummary: vi.fn(), getCurrentAttendance: vi.fn(),
  requestFleetHandoff: vi.fn(),
}));

vi.mock('next/router', () => ({ useRouter: () => mocks.router }));
vi.mock('@/modules/attendance/portal/client/api', async () => ({
  ...await vi.importActual<typeof import('@/modules/attendance/portal/client/api')>('@/modules/attendance/portal/client/api'),
  getSession: mocks.getSession,
  getHistory: mocks.getHistory,
  requestFleetHandoff: mocks.requestFleetHandoff,
}));
vi.mock('@/modules/attendance/portal/client/attendanceStateApi', async () => ({
  ...await vi.importActual<typeof import('@/modules/attendance/portal/client/attendanceStateApi')>('@/modules/attendance/portal/client/attendanceStateApi'),
  getAttendanceHubSummary: mocks.getHubSummary,
  getCurrentAttendance: mocks.getCurrentAttendance,
}));
vi.mock('@/modules/attendance/portal/client/MyPortalShell', () => ({
  MyPortalShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/modules/attendance/portal/client/InstallPrompt', () => ({ InstallPrompt: () => null }));
vi.mock('@/modules/field-stock-pwa/lib/storesRoles', () => ({ isStoresAuthorised: () => false }));

import MyAttendancePage from '../../pages/my/attendance';
import { MyHub } from '@/modules/attendance/portal/client/MyHub';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.router.query = {};
  mocks.router.pathname = '/my';
  mocks.getSession.mockResolvedValue(session);
  mocks.getHistory.mockResolvedValue(history);
  mocks.getCurrentAttendance.mockResolvedValue(currentAttendance());
  mocks.getHubSummary.mockResolvedValue({
    openEntry: null, assignedVehicle: null, latestPayslip: null, latestReceipt: null,
    pendingCorrectionsCount: 0, recentEntryCount: 1, requiredAttendanceAction: requiredAction,
  });
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { completed: true, checkin: { clearance: 'cleared' } } }),
  }) as unknown as typeof fetch;
});

describe('required action entry points', () => {
  it('renders the hub action before the Clock tile and routes with both IDs', async () => {
    const user = userEvent.setup();
    render(<MyHub profile={profile} />);
    const heading = await screen.findByRole('heading', { name: /previous clock-out missing/i });
    const clockTile = screen.getByText('Clock').closest('button');
    expect(clockTile).not.toBeNull();
    expect(heading.compareDocumentPosition(clockTile as HTMLButtonElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /submit clock-out correction/i }));
    expect(mocks.router.push).toHaveBeenCalledWith('/my/attendance/corrections/new?entry_id=en-1&exception_id=ex-1');
  });

  it('replaces the normal attendance clock action while correction is required', async () => {
    const user = userEvent.setup();
    mocks.getCurrentAttendance.mockResolvedValue(currentAttendance({ requiredAttendanceAction: requiredAction }));
    render(<MyAttendancePage />);
    await user.click(await screen.findByRole('button', { name: /submit clock-out correction/i }));
    expect(mocks.router.push).toHaveBeenCalledWith('/my/attendance/corrections/new?entry_id=en-1&exception_id=ex-1');
    expect(screen.queryByRole('button', { name: /^clock in$/i })).not.toBeInTheDocument();
  });

  it('fails closed on the attendance landing when current state cannot load', async () => {
    mocks.getCurrentAttendance.mockRejectedValue(new Error('current unavailable'));
    render(<MyAttendancePage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('current unavailable');
    expect(screen.queryByRole('button', { name: /^clock (in|out)$/i })).not.toBeInTheDocument();
  });

  it('derives the landing clock action from current.open rather than history', async () => {
    render(<MyAttendancePage />);
    const clockIn = await screen.findByRole('button', { name: /^clock in$/i });
    expect(clockIn.className).toContain('focus-visible:');
    expect(clockIn.className).toContain('active:');
    expect(clockIn.className).toContain('touch-manipulation');
    expect(screen.queryByRole('button', { name: /^clock out$/i })).not.toBeInTheDocument();
  });
});

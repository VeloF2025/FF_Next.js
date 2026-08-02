/** @vitest-environment jsdom */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hints, history, session } from './attendancePageFixtures';

const REQUIRED_EXCEPTION_ID = '22222222-2222-4222-8222-222222222222';
const FOREIGN_EXCEPTION_ID = '44444444-4444-4444-8444-444444444444';

const mocks = vi.hoisted(() => ({
  router: { query: { entry_id: 'en-1', exception_id: 'ex-1' }, push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  getSession: vi.fn(), getHistory: vi.fn(), getCorrectionHints: vi.fn(),
  getCorrectionTarget: vi.fn(), submitRequired: vi.fn(),
}));

vi.mock('next/router', () => ({ useRouter: () => mocks.router }));
vi.mock('@/modules/attendance/portal/client/api', async () => ({
  ...await vi.importActual<typeof import('@/modules/attendance/portal/client/api')>('@/modules/attendance/portal/client/api'),
  getSession: mocks.getSession,
  getHistory: mocks.getHistory,
  getCorrectionHints: mocks.getCorrectionHints,
}));
vi.mock('@/modules/attendance/portal/client/attendanceStateApi', async () => ({
  ...await vi.importActual<typeof import('@/modules/attendance/portal/client/attendanceStateApi')>('@/modules/attendance/portal/client/attendanceStateApi'),
  getCorrectionTarget: mocks.getCorrectionTarget,
  submitRequiredAttendanceCorrection: mocks.submitRequired,
}));
vi.mock('@/modules/attendance/portal/client/MyPortalShell', () => ({
  MyPortalShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import NewCorrectionPage from '../../pages/my/attendance/corrections/new';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.router.query = { entry_id: 'en-1', exception_id: 'ex-1' };
  mocks.getSession.mockResolvedValue(session);
  mocks.getHistory.mockResolvedValue(history);
  mocks.getCorrectionHints.mockResolvedValue({ hints, absoluteMinReasonChars: 10 });
  mocks.getCorrectionTarget.mockResolvedValue({ exceptionId: 'ex-1', entryId: 'en-1' });
  mocks.submitRequired.mockResolvedValue({
    adjustmentId: 'adj-1', exceptionId: 'ex-1', decisionEventId: 'event-1', exceptionStatus: 'awaiting_supervisor',
  });
});

describe('required missing-clock-out correction', () => {
  it('retains entered values and remains blocked after a network failure', async () => {
    const user = userEvent.setup();
    mocks.submitRequired.mockRejectedValue(new Error('Network unavailable'));
    render(<NewCorrectionPage />);
    const clockOut = await screen.findByLabelText(/correct clock-out/i);
    const reason = screen.getByLabelText(/why/i);
    await user.type(clockOut, '2026-08-03T17:00');
    await user.type(reason, 'Phone battery died before I could clock out.');
    await user.click(screen.getByRole('button', { name: /submit clock-out correction/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
    expect(clockOut).toHaveValue('2026-08-03T17:00');
    expect(reason).toHaveValue('Phone battery died before I could clock out.');
    expect(screen.queryByRole('link', { name: /^clock in$/i })).not.toBeInTheDocument();
  });

  it('unlocks the normal clock action only after the POST succeeds', async () => {
    const user = userEvent.setup();
    mocks.router.query = { exception_id: REQUIRED_EXCEPTION_ID };
    mocks.getCorrectionTarget.mockResolvedValue({
      exceptionId: REQUIRED_EXCEPTION_ID, entryId: 'en-1',
    });
    render(<NewCorrectionPage />);
    await user.type(await screen.findByLabelText(/correct clock-out/i), '2026-08-03T17:00');
    await user.type(screen.getByLabelText(/why/i), 'Phone battery died before I could clock out.');
    const submit = screen.getByRole('button', { name: /submit clock-out correction/i });
    expect(submit.className).toContain('focus-visible:');
    expect(submit.className).toContain('active:');
    expect(submit.className).toContain('touch-manipulation');
    await user.click(submit);
    expect(await screen.findByText("Today's clock-in is now enabled; supervisor review is pending")).toBeVisible();
    const clockIn = screen.getByRole('link', { name: /^clock in$/i });
    expect(clockIn).toHaveAttribute('href', '/my/attendance/clock?action=in');
    expect(clockIn.className).toContain('focus-visible:');
    expect(clockIn.className).toContain('active:');
    expect(clockIn.className).toContain('touch-manipulation');
    expect(mocks.submitRequired).toHaveBeenCalledWith({
      entryId: 'en-1', exceptionId: REQUIRED_EXCEPTION_ID,
      adjustedClockOutAt: '2026-08-03T15:00:00.000Z',
      reason: 'Phone battery died before I could clock out.',
    });
    expect(mocks.getCorrectionTarget).toHaveBeenCalledWith(REQUIRED_EXCEPTION_ID);
    await waitFor(() => expect(mocks.router.replace).not.toHaveBeenCalled());
  });

  it('fails closed when an exception-only target cannot be resolved', async () => {
    mocks.router.query = { exception_id: FOREIGN_EXCEPTION_ID };
    mocks.getCorrectionTarget.mockRejectedValue(new Error('Attendance correction not found'));

    render(<NewCorrectionPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Attendance correction not found');
    expect(screen.queryByLabelText(/correct clock-out/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/missing.*entry_id/i)).not.toBeInTheDocument();
    expect(mocks.getCorrectionTarget).toHaveBeenCalledWith(FOREIGN_EXCEPTION_ID);
  });
});

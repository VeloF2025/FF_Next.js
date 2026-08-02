/** @vitest-environment jsdom */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allQueue,
  item,
  ok,
  persistedDecision,
  queue,
  resolvedItem,
} from './staff-attendance-actions.fixtures';

const mocks = vi.hoisted(() => ({
  router: {
    pathname: '/staff/attendance/corrections', asPath: '/staff/attendance/corrections', query: {} as Record<string, string>,
    replace: vi.fn(), push: vi.fn(),
  },
}));

vi.mock('next/router', () => ({ useRouter: () => mocks.router }));
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div data-testid="app-layout">{children}</div>,
}));
vi.mock('@/components/attendance/AttendanceNav', () => ({
  AttendanceNav: () => <nav aria-label="Pulse navigation">Actions</nav>,
}));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import StaffAttendanceActionsPage from '../../pages/staff/attendance/corrections';
beforeEach(() => {
  vi.clearAllMocks(); mocks.router.query = {}; mocks.router.asPath = '/staff/attendance/corrections';
});

describe('supervisor attendance action queue', () => {
  it('distinguishes no worker scope from an exception-empty scoped result', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(ok(queue([], { kind: 'no_scope', reason: 'No assigned workers' })));
    const first = render(<StaffAttendanceActionsPage />);
    expect(await screen.findByText(/no workers are assigned to your attendance scope/i)).toBeVisible();
    first.unmount();
    global.fetch = vi.fn().mockResolvedValueOnce(ok(queue([])));
    render(<StaffAttendanceActionsPage />);
    expect(await screen.findByText(/no attendance actions match/i)).toBeVisible();
    expect(screen.getByText(/last checked/i)).toBeVisible();
  });

  it('shows loading and API failure states without a false empty result', async () => {
    let rejectRequest: (reason: Error) => void = () => undefined;
    global.fetch = vi.fn().mockImplementation(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
    render(<StaffAttendanceActionsPage />);
    expect(screen.getByText(/loading attendance actions/i)).toBeVisible();
    rejectRequest(new Error('Queue unavailable'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Queue unavailable');
    expect(screen.queryByText(/no attendance actions match/i)).not.toBeInTheDocument();
  });

  it('prioritises missing punches and renders all four bounded counts', async () => {
    const regular = item();
    const missing = item({
      id: '22222222-2222-4222-8222-222222222222', staffName: 'Anele Dlamini',
      kind: 'missing_clock_out', evidence: { ...regular.evidence, clockOutAt: null },
      dailyResult: { ...regular.dailyResult, blockingReasons: ['missing_clock_out'] },
    });
    global.fetch = vi.fn().mockResolvedValue(ok(queue([regular, missing])));
    render(<StaffAttendanceActionsPage />);
    const rows = await screen.findAllByTestId(/^attendance-action-item-/);
    expect(rows[0]).toHaveTextContent('Anele Dlamini');
    expect(within(screen.getByTestId('action-summary-present')).getByText('1')).toBeVisible();
    expect(within(screen.getByTestId('action-summary-flagged')).getByText('2')).toBeVisible();
    expect(within(screen.getByTestId('action-summary-open')).getByText('2')).toBeVisible();
    expect(within(screen.getByTestId('action-summary-missing-clock')).getByText('1')).toBeVisible();
  });

  it('selects the exact action requested by an exception_id deep link', async () => {
    const first = item(); const requested = item({
      id: '22222222-2222-4222-8222-222222222222', staffName: 'Exact Deep Link Worker',
    });
    mocks.router.query = { exception_id: requested.id }; global.fetch = vi.fn().mockResolvedValue(ok(queue([first, requested])));
    render(<StaffAttendanceActionsPage />);
    expect(await screen.findByTestId('action-detail')).toHaveTextContent('Exact Deep Link Worker');
  });

  it('loads the exact deep-linked action when it is outside the bounded queue page', async () => {
    const requested = item({ id: '33333333-3333-4333-8333-333333333333', staffName: 'Outside Queue Page' });
    mocks.router.query = { exception_id: requested.id };
    global.fetch = vi.fn().mockResolvedValueOnce(ok(queue([]))).mockResolvedValueOnce(ok(allQueue([requested])));
    render(<StaffAttendanceActionsPage />);
    expect(await screen.findByTestId('action-detail')).toHaveTextContent('Outside Queue Page');
    expect(screen.queryByText(/no attendance actions match/i)).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/staff/attendance-day-exceptions?status=all&limit=200', {
      credentials: 'same-origin',
    });
  });

  it('preserves pre-existing status and kind filters when either filter changes', async () => {
    const user = userEvent.setup();
    const missing = item({
      kind: 'missing_clock_out', evidence: { ...item().evidence, clockOutAt: null },
      dailyResult: { ...item().dailyResult, blockingReasons: ['missing_clock_out'] },
    });
    mocks.router.query = { status: 'awaiting_supervisor', kind: 'missing_clock_out' };
    global.fetch = vi.fn().mockResolvedValue(ok(queue(
      [missing], { kind: 'scoped', staffCount: 3 }, 'awaiting_supervisor'
    )));
    render(<StaffAttendanceActionsPage />);
    await user.selectOptions(await screen.findByLabelText(/action status/i), 'open');
    expect(mocks.router.replace).toHaveBeenCalledWith(
      { pathname: '/staff/attendance/corrections', query: { status: 'open', kind: 'missing_clock_out' } },
      undefined, { shallow: true }
    );
    await user.selectOptions(screen.getByLabelText(/action kind/i), 'late_arrival');
    expect(mocks.router.replace).toHaveBeenCalledWith(
      { pathname: '/staff/attendance/corrections', query: { status: 'awaiting_supervisor', kind: 'late_arrival' } },
      undefined, { shallow: true }
    );
  });

  it('marks missing evidence unavailable with queue-refresh context and shows proposed hours', async () => {
    global.fetch = vi.fn().mockResolvedValue(ok(queue([item({
      kind: 'missing_clock_out',
      evidence: {
        entryId: 'entry-1', clockInAt: '2026-07-31T06:00:00.000Z', clockOutAt: null,
        clockInGpsAvailable: false, clockOutGpsAvailable: false, selfies: [],
      },
    })])));
    render(<StaffAttendanceActionsPage />);
    expect(await screen.findByTestId('action-detail')).toHaveTextContent('Unavailable');
    expect(screen.getByTestId('action-detail')).toHaveTextContent(/last checked/i);
    expect(screen.getByTestId('action-detail')).toHaveTextContent(/proposed hours/i);
    expect(screen.queryByText(/verified match/i)).not.toBeInTheDocument();
    screen.getAllByText('Unavailable').forEach((evidence) => {
      expect(evidence).toHaveAttribute('data-evidence-status', 'unavailable');
      expect(evidence.className).not.toMatch(/green|emerald|success/i);
    });
  });

  it('preserves draft inputs and reloads the exact item after a 409 conflict', async () => {
    const user = userEvent.setup();
    const stale = item();
    global.fetch = vi.fn()
      .mockResolvedValueOnce(ok(queue([stale])))
      .mockResolvedValueOnce({
        ok: false, status: 409,
        json: async () => ({ success: false, error: { message: 'stale', details: { reason: 'result_stale' } } }),
      } as Response)
      .mockResolvedValueOnce(ok(allQueue([{ ...stale, resultVersion: 5 }])));
    render(<StaffAttendanceActionsPage />);
    await user.type(await screen.findByLabelText(/decision reason/i), 'Reviewed against site register');
    await user.click(screen.getByRole('button', { name: /approve for payroll/i }));
    expect(await screen.findByTestId('stale-state-message')).toHaveTextContent(
      'This attendance action changed since you opened it. Your decision was not saved. Review the refreshed details and try again.'
    );
    expect(screen.getByLabelText(/decision reason/i)).toHaveValue('Reviewed against site register');
    expect(screen.getByText(/result version 5/i)).toBeVisible();
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch).toHaveBeenNthCalledWith(
      3, '/api/staff/attendance-day-exceptions?status=all&limit=200',
      { credentials: 'same-origin' }
    );
  });

  it('confirms exact persisted state before refreshing the filtered list and showing success', async () => {
    const user = userEvent.setup();
    let resolvePost: (value: Response) => void = () => undefined;
    const post = new Promise<Response>((resolve) => { resolvePost = resolve; });
    const resolved = resolvedItem();
    global.fetch = vi.fn()
      .mockResolvedValueOnce(ok(queue([item()])))
      .mockReturnValueOnce(post)
      .mockResolvedValueOnce(ok(allQueue([resolved])))
      .mockResolvedValueOnce(ok(queue([])));
    render(<StaffAttendanceActionsPage />);
    await user.type(await screen.findByLabelText(/decision reason/i), 'Approved after evidence review');
    await user.click(screen.getByRole('button', { name: /approve for payroll/i }));
    expect(screen.queryByTestId('action-success')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve for payroll/i })).toBeDisabled();
    resolvePost(ok(persistedDecision(resolved)));
    expect(await screen.findByTestId('action-success')).toHaveTextContent(/saved and confirmed/i);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));
    expect(global.fetch).toHaveBeenNthCalledWith(
      3, '/api/staff/attendance-day-exceptions?status=all&limit=200',
      { credentials: 'same-origin' }
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      4, '/api/staff/attendance-day-exceptions?status=unresolved&limit=50',
      { credentials: 'same-origin' }
    );
  });

  it('fails closed when the exact persisted item is absent from readback', async () => {
    const user = userEvent.setup();
    const resolved = resolvedItem();
    global.fetch = vi.fn()
      .mockResolvedValueOnce(ok(queue([item()])))
      .mockResolvedValueOnce(ok(persistedDecision(resolved)))
      .mockResolvedValueOnce(ok(allQueue([])));
    render(<StaffAttendanceActionsPage />);
    await user.type(await screen.findByLabelText(/decision reason/i), 'Approved after evidence review');
    await user.click(screen.getByRole('button', { name: /approve for payroll/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/exact attendance action could not be confirmed/i);
    expect(screen.queryByTestId('action-success')).not.toBeInTheDocument();
  });

  it('rejects an exact readback whose state does not match the persisted decision', async () => {
    const user = userEvent.setup();
    const resolved = resolvedItem();
    const inconsistent = { ...resolved, status: 'cancelled' as const };
    global.fetch = vi.fn()
      .mockResolvedValueOnce(ok(queue([item()])))
      .mockResolvedValueOnce(ok(persistedDecision(resolved)))
      .mockResolvedValueOnce(ok(allQueue([inconsistent])));
    render(<StaffAttendanceActionsPage />);
    await user.type(await screen.findByLabelText(/decision reason/i), 'Approved after evidence review');
    await user.click(screen.getByRole('button', { name: /approve for payroll/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/readback did not match/i);
    expect(screen.queryByTestId('action-success')).not.toBeInTheDocument();
  });

  it('rejects readback when persisted exception and daily-result versions disagree', async () => {
    const user = userEvent.setup();
    const resolved = resolvedItem();
    const inconsistent = persistedDecision(resolved);
    inconsistent.dailyResult.resultVersion = 6;
    global.fetch = vi.fn()
      .mockResolvedValueOnce(ok(queue([item()])))
      .mockResolvedValueOnce(ok(inconsistent))
      .mockResolvedValueOnce(ok(allQueue([resolved])))
      .mockResolvedValueOnce(ok(queue([])));
    render(<StaffAttendanceActionsPage />);
    await user.type(await screen.findByLabelText(/decision reason/i), 'Approved after evidence review');
    await user.click(screen.getByRole('button', { name: /approve for payroll/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/readback did not match/i);
    expect(screen.queryByTestId('action-success')).not.toBeInTheDocument();
  });
});

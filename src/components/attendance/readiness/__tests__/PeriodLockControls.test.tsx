/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PeriodLockControls } from '../PeriodLockControls';
import type {
  BulkWeekReadiness,
  PeriodReadiness,
  WeeklyLockView,
} from '../usePeriodReadiness';

const ready: PeriodReadiness = {
  weekStartDate: '2026-07-27', weekEndDate: '2026-08-02', activeStaffCount: 2,
  expectedDayCount: 12, approvedDayCount: 12, blockerCount: 0,
  unapprovedOvertimeHours: 0, unapprovedSundayHours: 0,
  reconciliationLastSucceededAt: '2026-08-03T05:00:00.000Z',
  reconciliationFresh: true, readyToLock: true, blockers: [],
};

const activeLock: WeeklyLockView = {
  week_start_date: ready.weekStartDate, locked_at: '2026-08-03T06:00:00.000Z',
  locked_by: 'admin-1', lock_reason: 'Approved payroll close', unlocked_at: null,
  unlocked_by: null, unlock_reason: null, lock_version: 3, latest_action: 'relock',
  latest_actor_user_id: 'admin-2', latest_reason: 'Re-locked after approved correction',
  latest_recorded_at: '2026-08-03T07:30:00.000Z',
};

function bulk(weekStartDate: string, readiness: PeriodReadiness | null): BulkWeekReadiness {
  return { weekStartDate, readiness, loading: false, error: null };
}

describe('PeriodLockControls', () => {
  it('renders read-only visibility without misleading mutations for non-HR roles', () => {
    render(
      <PeriodLockControls readiness={ready} lock={null} canManage={false} busy={false}
        error={null} bulkWeeks={[bulk(ready.weekStartDate, ready)]}
        onLock={vi.fn()} onUnlock={vi.fn()} onBulkLock={vi.fn()}
        onAddBulkWeek={vi.fn()} onRemoveBulkWeek={vi.fn()} />
    );
    expect(screen.getByTestId('lock-read-only')).toHaveTextContent(/read-only/i);
    expect(screen.queryByRole('button', { name: /^lock week/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /unlock week/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /lock selected weeks/i })).not.toBeInTheDocument();
  });

  it('keeps lock disabled when server readiness is false', async () => {
    const blocked = { ...ready, readyToLock: false, blockerCount: 1 };
    render(
      <PeriodLockControls readiness={blocked} lock={null} canManage busy={false}
        error={null} bulkWeeks={[bulk(blocked.weekStartDate, blocked)]}
        onLock={vi.fn()} onUnlock={vi.fn()} onBulkLock={vi.fn()}
        onAddBulkWeek={vi.fn()} onRemoveBulkWeek={vi.fn()} />
    );
    await userEvent.setup().type(screen.getByLabelText(/^lock reason$/i), 'Payroll close approved');
    expect(screen.getByRole('button', { name: /^lock week/i })).toBeDisabled();
    expect(screen.getByText(/server reports this week is not ready/i)).toBeVisible();
  });

  it('requires explicit unlock confirmation and preserves its reason after an error', async () => {
    const user = userEvent.setup();
    const onUnlock = vi.fn();
    const view = render(
      <PeriodLockControls readiness={{ ...ready, readyToLock: false }} lock={activeLock}
        canManage busy={false} error={null} bulkWeeks={[]}
        onLock={vi.fn()} onUnlock={onUnlock} onBulkLock={vi.fn()}
        onAddBulkWeek={vi.fn()} onRemoveBulkWeek={vi.fn()} />
    );
    await user.click(screen.getByRole('button', { name: /unlock week/i }));
    const reason = screen.getByLabelText(/unlock reason/i);
    await user.type(reason, 'Need late correction review');
    expect(screen.getByRole('button', { name: /confirm unlock/i })).toBeEnabled();

    view.rerender(
      <PeriodLockControls readiness={{ ...ready, readyToLock: false }} lock={activeLock}
        canManage busy={false} error="Concurrent update" bulkWeeks={[]}
        onLock={vi.fn()} onUnlock={onUnlock} onBulkLock={vi.fn()}
        onAddBulkWeek={vi.fn()} onRemoveBulkWeek={vi.fn()} />
    );
    expect(screen.getByLabelText(/unlock reason/i)).toHaveValue('Need late correction review');
    await user.click(screen.getByRole('button', { name: /confirm unlock/i }));
    expect(onUnlock).toHaveBeenCalledOnce();
    expect(onUnlock).toHaveBeenCalledWith('Need late correction review');
  });

  it('enables bulk lock only when every selected week independently reports ready', async () => {
    const user = userEvent.setup();
    const blocked = { ...ready, weekStartDate: '2026-07-20', weekEndDate: '2026-07-26', readyToLock: false, blockerCount: 2 };
    const onBulkLock = vi.fn();
    const view = render(
      <PeriodLockControls readiness={ready} lock={null} canManage busy={false} error={null}
        bulkWeeks={[bulk(ready.weekStartDate, ready), bulk(blocked.weekStartDate, blocked)]}
        onLock={vi.fn()} onUnlock={vi.fn()} onBulkLock={onBulkLock}
        onAddBulkWeek={vi.fn()} onRemoveBulkWeek={vi.fn()} />
    );
    await user.type(screen.getByLabelText(/bulk lock reason/i), 'Close both approved payroll weeks');
    expect(screen.getByRole('button', { name: /lock selected weeks/i })).toBeDisabled();

    view.rerender(
      <PeriodLockControls readiness={ready} lock={null} canManage busy={false} error={null}
        bulkWeeks={[bulk(ready.weekStartDate, ready), bulk(blocked.weekStartDate, { ...blocked, readyToLock: true, blockerCount: 0 })]}
        onLock={vi.fn()} onUnlock={vi.fn()} onBulkLock={onBulkLock}
        onAddBulkWeek={vi.fn()} onRemoveBulkWeek={vi.fn()} />
    );
    await user.click(screen.getByRole('button', { name: /lock selected weeks/i }));
    expect(onBulkLock).toHaveBeenCalledWith(
      [ready.weekStartDate, blocked.weekStartDate],
      'Close both approved payroll weeks'
    );
  });

  it('disables every command while a submission is in flight', () => {
    render(
      <PeriodLockControls readiness={ready} lock={null} canManage busy error={null}
        bulkWeeks={[bulk(ready.weekStartDate, ready)]}
        onLock={vi.fn()} onUnlock={vi.fn()} onBulkLock={vi.fn()}
        onAddBulkWeek={vi.fn()} onRemoveBulkWeek={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: /^lock week/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /lock selected weeks/i })).toBeDisabled();
  });

  it('renders the complete latest audit record supplied by the server', () => {
    render(
      <PeriodLockControls readiness={{ ...ready, readyToLock: false }} lock={activeLock}
        canManage={false} busy={false} error={null} bulkWeeks={[]}
        onLock={vi.fn()} onUnlock={vi.fn()} onBulkLock={vi.fn()}
        onAddBulkWeek={vi.fn()} onRemoveBulkWeek={vi.fn()} />
    );
    expect(screen.getByText(/latest audit version/i).parentElement).toHaveTextContent('v3');
    expect(screen.getByText(/latest audit action/i).parentElement).toHaveTextContent('relock');
    expect(screen.getByText(/latest audit actor/i).parentElement).toHaveTextContent('admin-2');
    expect(screen.getByText(/latest audit reason/i).parentElement).toHaveTextContent('Re-locked after approved correction');
    expect(screen.getByText(/latest audit timestamp/i).parentElement).toHaveTextContent(/2026-08-03/);
  });

  it.each([null, 0, 'NaN', 1.5])('does not treat lock version %s as an active lock', (lockVersion) => {
    render(
      <PeriodLockControls readiness={{ ...ready, readyToLock: false }}
        lock={{ ...activeLock, lock_version: lockVersion }} canManage busy={false}
        error={null} bulkWeeks={[]} onLock={vi.fn()} onUnlock={vi.fn()}
        onBulkLock={vi.fn()} onAddBulkWeek={vi.fn()} onRemoveBulkWeek={vi.fn()} />
    );
    expect(screen.getByText(/active lock version/i).parentElement).toHaveTextContent('None');
    expect(screen.queryByRole('button', { name: /unlock week/i })).not.toBeInTheDocument();
  });
});

/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DayExceptionItem } from '@/modules/attendance/workflow/types';
import { DecisionForm } from '../DecisionForm';

const sundayWorkItem: DayExceptionItem = {
  id: '11111111-1111-4111-8111-111111111111',
  staffId: 'staff-1',
  staffName: 'Lerato Ndlovu',
  workDate: '2026-08-02',
  kind: 'sunday_work',
  status: 'awaiting_supervisor',
  permittedActions: ['approve'],
  resultVersion: 4,
  queueOwnerUserId: null,
  createdAt: '2026-08-02T12:00:00.000Z',
  crewName: 'Crew Delta',
  site: { id: 'site-1', name: 'Midrand Core' },
  evidence: {
    entryId: 'entry-1',
    clockInAt: '2026-08-02T06:00:00.000Z',
    clockOutAt: '2026-08-02T11:00:00.000Z',
    clockInGpsAvailable: true,
    clockOutGpsAvailable: true,
    selfies: [{ entryId: 'entry-1', kind: 'in' }],
  },
  adjustment: null,
  proposedHours: { regular: 0, overtime: 0, sunday: 5, holiday: 0 },
  dailyResult: {
    status: 'awaiting_supervisor',
    scheduledPaidHours: 5,
    recordedElapsedHours: 5,
    proposedHours: { regular: 0, overtime: 0, sunday: 5, holiday: 0, leave: 0, unpaid: 0 },
    approvedHours: null,
    attendanceClassification: null,
    blockingReasons: ['sunday_work'],
  },
};

const pendingCorrectionItem: DayExceptionItem = {
  ...sundayWorkItem,
  id: '22222222-2222-4222-8222-222222222222',
  kind: 'missing_clock_out',
  permittedActions: ['approve', 'return'],
  evidence: { ...sundayWorkItem.evidence, clockOutAt: null },
  adjustment: {
    id: 'adjustment-1',
    kind: 'clock_out',
    adjustedClockInAt: null,
    adjustedClockOutAt: '2026-08-02T11:00:00.000Z',
    reason: 'Forgot to clock out',
    status: 'pending',
  },
  dailyResult: {
    ...sundayWorkItem.dailyResult,
    blockingReasons: ['missing_clock_out'],
  },
};

describe('DecisionForm', () => {
  it('submits proposed Sunday hours through the explicit approval path', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<DecisionForm item={sundayWorkItem} onSubmit={onSubmit} busy={false} />);

    expect(screen.getByText(/sunday work/i)).toBeVisible();
    expect(screen.getByLabelText(/approved sunday hours/i)).toHaveValue(5);
    await user.type(screen.getByLabelText(/decision reason/i), 'Approved planned repair crew');
    await user.click(screen.getByRole('button', { name: /approve for payroll/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'approve',
      approvedHours: expect.objectContaining({ sunday: 5 }),
      reason: 'Approved planned repair crew',
    }));
    expect(screen.queryByRole('button', { name: /return to worker/i })).not.toBeInTheDocument();
  });

  it('offers return only for evidence of a pending worker correction', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <DecisionForm item={pendingCorrectionItem} onSubmit={onSubmit} busy={false} />
    );
    await user.type(screen.getByLabelText(/decision reason/i), 'Worker must confirm the missing evidence');
    await user.click(screen.getByRole('button', { name: /return to worker/i }));
    expect(onSubmit).toHaveBeenLastCalledWith({
      action: 'return', reason: 'Worker must confirm the missing evidence',
    });
  });

  it('keeps absence classification separate without exposing an invalid return', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<DecisionForm item={{
      ...sundayWorkItem,
      kind: 'missing_clock_in',
      permittedActions: ['classify'],
      evidence: { ...sundayWorkItem.evidence, entryId: null, clockInAt: null, clockOutAt: null },
    }} onSubmit={onSubmit} busy={false} />);
    await user.selectOptions(screen.getByLabelText(/absence classification/i), 'unauthorised_absence');
    await user.type(screen.getByLabelText(/decision reason/i), 'No authorised leave or work evidence supplied');
    expect(screen.queryByRole('button', { name: /return to worker/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /classify absence/i }));
    expect(onSubmit).toHaveBeenLastCalledWith({
      action: 'classify', classification: 'unauthorised_absence',
      reason: 'No authorised leave or work evidence supplied',
    });
  });

  it.each(['resolved', 'cancelled'] as const)('renders %s items read-only', (status) => {
    const dailyStatus = status === 'resolved' ? 'approved' as const : 'open' as const;
    render(
      <DecisionForm item={{
        ...sundayWorkItem, status,
        permittedActions: [],
        dailyResult: {
          ...sundayWorkItem.dailyResult, status: dailyStatus,
          approvedHours: status === 'resolved' ? sundayWorkItem.dailyResult.proposedHours : null,
        },
      }} onSubmit={vi.fn()} busy={false} />
    );
    expect(screen.getByTestId('decision-read-only')).toHaveTextContent(/no further decision can be submitted/i);
    expect(screen.queryByLabelText(/decision reason/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve|return|classify/i })).not.toBeInTheDocument();
  });

  it('retains supervisor inputs when the same item reloads at a newer version', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DecisionForm item={sundayWorkItem} onSubmit={vi.fn()} busy={false} />
    );
    await user.type(screen.getByLabelText(/decision reason/i), 'Draft survives stale refresh');
    await user.clear(screen.getByLabelText(/approved sunday hours/i));
    await user.type(screen.getByLabelText(/approved sunday hours/i), '4.5');

    rerender(
      <DecisionForm item={{ ...sundayWorkItem, resultVersion: 5 }} onSubmit={vi.fn()} busy={false} />
    );
    expect(screen.getByLabelText(/decision reason/i)).toHaveValue('Draft survives stale refresh');
    expect(screen.getByLabelText(/approved sunday hours/i)).toHaveValue(4.5);
  });

  it('prevents duplicate decisions while a request is busy', () => {
    render(<DecisionForm item={pendingCorrectionItem} onSubmit={vi.fn()} busy />);
    expect(screen.getByRole('button', { name: /approve for payroll/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /return to worker/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /classify absence/i })).not.toBeInTheDocument();
  });

  it('renders no mutation controls when the server permits no action', () => {
    render(<DecisionForm item={{
      ...pendingCorrectionItem,
      status: 'awaiting_worker',
      permittedActions: [],
    }} onSubmit={vi.fn()} busy={false} />);
    expect(screen.getByTestId('decision-read-only')).toBeVisible();
    expect(screen.queryByRole('button', { name: /approve|return|classify/i })).not.toBeInTheDocument();
  });
});

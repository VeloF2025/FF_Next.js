import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SiteInferencePanel } from '../SiteInferencePanel';
import type { SiteInferenceProposal } from '../../inference/proposalQueries';

const LAWLEY = 'p-lawley';
const MOHADIN = 'p-mohadin';

function proposal(overrides: Partial<SiteInferenceProposal> = {}): SiteInferenceProposal {
  return {
    vehicleId: 'v-1', registration: 'MW94RBGP', outcome: 'confident',
    inferredProjectId: LAWLEY, inferredProjectName: 'Lawley', dominantShare: 0.839,
    pings: 22581, dwellSeconds: 393_480, distinctDays: 22, totalPositions: 42_889,
    windowStart: '2026-07-17T00:00:00.000Z', windowEnd: '2026-08-21T00:00:00.000Z',
    breakdown: [
      { projectId: LAWLEY, projectName: 'Lawley', pings: 19646, dwellSeconds: 330_480, distinctDays: 22, share: 0.839 },
      { projectId: MOHADIN, projectName: "Themb'elihle", pings: 2198, dwellSeconds: 50_760, distinctDays: 15, share: 0.129 },
    ],
    computedAt: '2026-08-21T00:00:00.000Z', decision: null, decidedProjectId: null,
    decidedProjectName: null, decidedFrom: null, note: null, decidedBy: null, decidedAt: null,
    decisionMatchesInference: null, effectiveProjectId: LAWLEY, appliedAssignmentId: null,
    appliedAt: null,
    drivers: [{ staffId: 's-1', staffName: 'Marthinus Van De Venter',
      vehicleAssignmentId: 'va-1', assignmentRegistration: 'EMN889GP' }],
    ...overrides,
  };
}

const projects = [{ id: LAWLEY, label: 'Lawley' }, { id: MOHADIN, label: 'Mohadin' }];
const handlers = {
  onDecide: vi.fn(), onApply: vi.fn(), onRevert: vi.fn(), onRecompute: vi.fn(),
};

function panel(proposals: SiteInferenceProposal[], canEdit = true) {
  return render(<SiteInferencePanel
    proposals={proposals} projects={projects} canEdit={canEdit} {...handlers} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const handler of Object.values(handlers)) handler.mockResolvedValue(undefined);
});

describe('SiteInferencePanel', () => {
  it('shows the evidence behind a suggestion, not just the answer', () => {
    panel([proposal()]);
    expect(screen.getByText(/MW94RBGP/)).toBeInTheDocument();
    expect(screen.getByText(/83\.9% of 109\.3h dwell · 22581 pings · 22 days/)).toBeInTheDocument();
    expect(screen.getByText(/Lawley: 83\.9%/)).toBeInTheDocument();
  });

  it('warns when the vehicle assignment records a different registration', () => {
    // 5 of 24 active rows on production carry a stale registration string.
    panel([proposal()]);
    expect(screen.getByText(/records a different registration/)).toBeInTheDocument();
    expect(screen.getByText(/EMN889GP/)).toBeInTheDocument();
  });

  it('assigns the inferred project when no override is chosen', async () => {
    panel([proposal()]);
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(handlers.onDecide).toHaveBeenCalledWith(
      'v-1', { decision: 'assigned', overrideProjectId: null }));
  });

  it('sends the override when one is chosen', async () => {
    panel([proposal()]);
    await userEvent.selectOptions(
      screen.getByLabelText('Override project for MW94RBGP'), MOHADIN);
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(handlers.onDecide).toHaveBeenCalledWith(
      'v-1', { decision: 'assigned', overrideProjectId: MOHADIN }));
  });

  it('offers roaming as an answer rather than leaving the row flagged', async () => {
    panel([proposal({ outcome: 'roaming', inferredProjectId: null, inferredProjectName: null,
      dominantShare: 0.541, effectiveProjectId: null })]);
    expect(screen.getByText(/Roams between sites/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm roaming' }));
    await waitFor(() => expect(handlers.onDecide).toHaveBeenCalledWith(
      'v-1', { decision: 'roaming_confirmed' }));
  });

  it('cannot assign a roaming proposal until a project is picked', async () => {
    panel([proposal({ outcome: 'roaming', inferredProjectId: null, inferredProjectName: null })]);
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
    await userEvent.selectOptions(
      screen.getByLabelText('Override project for MW94RBGP'), MOHADIN);
    expect(screen.getByRole('button', { name: 'Assign' })).toBeEnabled();
  });

  it('will not apply a proposal nobody has assigned', () => {
    panel([proposal()]);
    expect(screen.getByRole('button', { name: 'Apply to roster' })).toBeDisabled();
  });

  it('applies only once, then offers revert instead', () => {
    const { rerender } = panel([proposal({ decision: 'assigned', decidedProjectId: LAWLEY,
      decidedProjectName: 'Lawley', decidedFrom: 'inference', decisionMatchesInference: true })]);
    expect(screen.getByRole('button', { name: 'Apply to roster' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Revert' })).toBeDisabled();

    rerender(<SiteInferencePanel proposals={[proposal({ decision: 'assigned',
      decidedProjectId: LAWLEY, decidedProjectName: 'Lawley', decidedFrom: 'inference',
      appliedAssignmentId: 'a-1', decisionMatchesInference: true })]}
      projects={projects} canEdit {...handlers} />);
    expect(screen.getByRole('button', { name: 'Apply to roster' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Revert' })).toBeEnabled();
  });

  it('applies without accepting warnings by default, and with them when ticked', async () => {
    const assigned = proposal({ decision: 'assigned', decidedProjectId: LAWLEY,
      decidedProjectName: 'Lawley', decidedFrom: 'inference', decisionMatchesInference: true });
    panel([assigned]);
    await userEvent.click(screen.getByRole('button', { name: 'Apply to roster' }));
    await waitFor(() => expect(handlers.onApply).toHaveBeenCalledWith('v-1', false));

    handlers.onApply.mockClear();
    await userEvent.click(screen.getByLabelText('Accept roster warnings for MW94RBGP'));
    await userEvent.click(screen.getByRole('button', { name: 'Apply to roster' }));
    await waitFor(() => expect(handlers.onApply).toHaveBeenCalledWith('v-1', true));
  });

  it('flags a decision that no longer matches the current GPS reading', () => {
    panel([proposal({ decision: 'assigned', decidedProjectId: MOHADIN,
      decidedProjectName: 'Mohadin', decidedFrom: 'override', decisionMatchesInference: false })]);
    expect(screen.getByText(/differs from the current GPS reading/)).toBeInTheDocument();
  });

  it('surfaces a failed action instead of swallowing it', async () => {
    handlers.onDecide.mockRejectedValue(new Error('That project has no active operational site.'));
    panel([proposal()]);
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    expect(await screen.findByRole('alert'))
      .toHaveTextContent('That project has no active operational site.');
  });

  it('hides every action from a read-only viewer', () => {
    panel([proposal()], false);
    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Recompute from GPS' })).toBeNull();
    expect(screen.getByText(/MW94RBGP/)).toBeInTheDocument();
  });

  it('says a vehicle has no driver rather than showing an empty line', () => {
    panel([proposal({ drivers: [] })]);
    expect(screen.getByText('No current driver')).toBeInTheDocument();
  });
});

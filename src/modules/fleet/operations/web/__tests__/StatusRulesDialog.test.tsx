import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusRulesDialog } from '../StatusRulesDialog';

const current = {
  id: 'rule-2', version: 2, timezone: 'Africa/Johannesburg', effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: null,
  monitoringBeforeMinutes: 60, monitoringAfterMinutes: 45, arrivalDwellMinutes: 5,
  wrongSiteConfirmationMinutes: 10, earlyDepartureConfirmationMinutes: 15,
  approachingDistanceMeters: 5000, approachingMinReadings: 2, minimumMovingSpeedKmh: 6,
  evidenceMismatchToleranceMeters: 250, changeReason: 'Initial rollout', createdBy: 'user-1', createdAt: '2026-08-01T00:00:00.000Z',
};
const previous = { ...current, id: 'rule-1', version: 1, effectiveFrom: '2026-07-01T00:00:00.000Z', effectiveTo: current.effectiveFrom, changeReason: 'Baseline' };
const created = { ...current, id: 'rule-3', version: 3, monitoringBeforeMinutes: 90, effectiveFrom: '2099-01-01T00:00:00.000Z', changeReason: 'Longer mobilisation window' };
const response = (data: unknown, ok = true, status = 200, message = 'Request failed') => ({ ok, status, json: async () => ok ? { success: true, data } : { success: false, error: { message } } }) as Response;
const fetchMock = vi.fn<typeof fetch>();

async function fillValidChange() {
  fireEvent.change(await screen.findByLabelText('Monitoring before shift (minutes)'), { target: { value: '90' } });
  fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2099-01-01T02:00' } });
  fireEvent.change(screen.getByLabelText('Change reason'), { target: { value: '  Longer mobilisation window  ' } });
}

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockResolvedValue(response([current, previous])); });

describe('StatusRulesDialog', () => {
  it('shows current values with units, provider freshness behavior, and immutable history', async () => {
    render(<StatusRulesDialog open onClose={vi.fn()} canEdit />);
    expect(await screen.findByLabelText('Monitoring before shift (minutes)')).toHaveValue(60);
    expect(screen.getByLabelText('Approaching distance (metres)')).toHaveValue(5000);
    expect(screen.getByLabelText('Minimum moving speed (km/h)')).toHaveValue(6);
    expect(screen.getByText(/GPS freshness is read-only/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Rule history')).toHaveTextContent('Version 2');
    expect(screen.getByLabelText('Rule history')).toHaveTextContent('Version 1');
  });

  it('requires a reason and rejects invalid thresholds', async () => {
    render(<StatusRulesDialog open onClose={vi.fn()} canEdit />); await screen.findByLabelText('Monitoring before shift (minutes)');
    expect(screen.getByRole('button', { name: 'Create rule version' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Change reason'), { target: { value: 'Adjust threshold' } });
    fireEvent.change(screen.getByLabelText('Arrival dwell (minutes)'), { target: { value: '-1' } });
    expect(screen.getByText('Use a non-negative whole number.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create rule version' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requires at least two approaching readings', async () => {
    render(<StatusRulesDialog open onClose={vi.fn()} canEdit />);
    const input = await screen.findByLabelText('Approaching minimum readings (readings)');
    expect(input).toHaveAttribute('min', '2');
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Change reason'), { target: { value: 'Unsafe single sample' } });
    expect(screen.getByText('Use a whole number of at least 2.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create rule version' })).toBeDisabled();
  });

  it('does not allow a historical rule activation', async () => {
    render(<StatusRulesDialog open onClose={vi.fn()} canEdit />); await screen.findByLabelText('Effective from');
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2020-01-01T00:00' } });
    fireEvent.change(screen.getByLabelText('Change reason'), { target: { value: 'Backdated change' } });
    expect(screen.getByRole('button', { name: 'Create rule version' })).toBeDisabled();
  });

  it('shows a before and after summary for changed thresholds', async () => {
    render(<StatusRulesDialog open onClose={vi.fn()} canEdit />); await fillValidChange();
    expect(screen.getByLabelText('Rule change summary')).toHaveTextContent('Monitoring before shift');
    expect(screen.getByLabelText('Rule change summary')).toHaveTextContent('60 min → 90 min');
  });

  it('waits for API success and refreshes history after creating a version', async () => {
    let resolveCreate!: (value: Response) => void; const pending = new Promise<Response>((resolve) => { resolveCreate = resolve; });
    fetchMock.mockReset().mockResolvedValueOnce(response([current, previous])).mockReturnValueOnce(pending).mockResolvedValueOnce(response([created, current, previous]));
    render(<StatusRulesDialog open onClose={vi.fn()} canEdit />); await fillValidChange();
    fireEvent.click(screen.getByRole('button', { name: 'Create rule version' }));
    expect(screen.getByRole('button', { name: 'Creating version…' })).toBeDisabled();
    expect(screen.getByLabelText('Rule history')).not.toHaveTextContent('Version 3');
    await act(async () => resolveCreate(response(created, true, 201)));
    await waitFor(() => expect(screen.getByLabelText('Rule history')).toHaveTextContent('Version 3'));
    const post = fetchMock.mock.calls[1]!; expect(post[0]).toBe('/api/fleet/operations/rules');
    expect(JSON.parse(String((post[1] as RequestInit).body))).toMatchObject({ monitoringBeforeMinutes: 90, changeReason: 'Longer mobilisation window', effectiveFrom: '2099-01-01T00:00:00.000Z' });
  });

  it('retains the proposed values and server error after a failed create', async () => {
    fetchMock.mockReset().mockResolvedValueOnce(response([current])).mockResolvedValueOnce(response(undefined, false, 400, 'Activation overlaps the current rule'));
    render(<StatusRulesDialog open onClose={vi.fn()} canEdit />); await fillValidChange();
    fireEvent.click(screen.getByRole('button', { name: 'Create rule version' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Activation overlaps the current rule');
    expect(screen.getByLabelText('Monitoring before shift (minutes)')).toHaveValue(90);
    expect(screen.getByLabelText('Change reason')).toHaveValue('  Longer mobilisation window  ');
  });

  it('keeps history read-only when edit permission is absent', async () => {
    render(<StatusRulesDialog open onClose={vi.fn()} canEdit={false} />); await waitFor(() => expect(screen.getByLabelText('Rule history')).toHaveTextContent('Version 2'));
    expect(screen.queryByRole('button', { name: 'Create rule version' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Rule history')).toBeInTheDocument();
  });
});

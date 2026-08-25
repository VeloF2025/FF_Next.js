import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VehicleRulesDialog } from '../VehicleRulesDialog';
import type { VehicleOperationalRule } from '../../../vehicleDetectors/types';

const current: VehicleOperationalRule = {
  id: 'rule-2', version: 2, timezone: 'Africa/Johannesburg',
  effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: null,
  afterHoursStartTime: '21:00:00', afterHoursEndTime: '05:00:00',
  weekendsAreAfterHours: true, publicHolidaysAreAfterHours: true,
  theftDisplacementMeters: 500, theftMinPositions: 2,
  harshLinearG: 0.35, harshLateralG: 0.35, harshMinSpeedKph: 20, speedOverLimitKph: 15,
  unauthorizedStopMinutes: 45, lostContactMinutes: 30, idleAlertMinutes: 20,
  knownSiteRadiusMeters: 500, changeReason: 'Initial rollout', createdBy: 'user-1',
  createdAt: '2026-08-01T00:00:00.000Z',
};
const previous: VehicleOperationalRule = {
  ...current, id: 'rule-1', version: 1,
  effectiveFrom: '2026-07-01T00:00:00.000Z', effectiveTo: current.effectiveFrom, changeReason: 'Baseline',
};

const response = (data: unknown, ok = true, status = 200, message = 'Request failed') => ({
  ok, status, json: async () => (ok ? { success: true, data } : { success: false, error: { message } }),
}) as Response;

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(response([current, previous]));
});

describe('VehicleRulesDialog', () => {
  it('renders nothing while closed, so the list is not fetched', () => {
    render(<VehicleRulesDialog open={false} onClose={vi.fn()} canEdit />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the current thresholds with their units and the immutable history', async () => {
    render(<VehicleRulesDialog open onClose={vi.fn()} canEdit />);
    expect(await screen.findByLabelText('Theft displacement (metres)')).toHaveValue(500);
    expect(screen.getByLabelText('Theft minimum positions (fixes)')).toHaveValue(2);
    expect(screen.getByLabelText('Harsh braking threshold (g)')).toHaveValue(0.35);
    expect(screen.getByLabelText('Lost contact floor (minutes)')).toHaveValue(30);
    expect(screen.getByLabelText('After-hours start')).toHaveValue('21:00');
    expect(screen.getByLabelText('After-hours end')).toHaveValue('05:00');
    expect(screen.getByLabelText('Weekends are after-hours')).toBeChecked();
    expect(screen.getByLabelText('Vehicle rule history')).toHaveTextContent('Version 2');
    expect(screen.getByLabelText('Vehicle rule history')).toHaveTextContent('Version 1');
  });

  it('labels the open version "Current" only while it is actually in force', async () => {
    render(<VehicleRulesDialog open onClose={vi.fn()} canEdit />);
    expect(await screen.findByText('Current thresholds')).toBeInTheDocument();
    expect(screen.getByLabelText('Vehicle rule history')).toHaveTextContent('effective');
  });

  it('labels a future-dated open version as pending, because it is not in force yet', async () => {
    // A version created with a future activation is OPEN but PENDING: the
    // detectors are still reading the previous one. Calling it "Current" tells
    // an operator a threshold is live when it is not.
    const scheduled = { ...current, id: 'rule-3', version: 3, effectiveFrom: '2099-01-01T00:00:00.000Z' };
    fetchMock.mockResolvedValue(response([scheduled, { ...current, effectiveTo: scheduled.effectiveFrom }]));
    render(<VehicleRulesDialog open onClose={vi.fn()} canEdit />);

    expect(await screen.findByText(/^Pending from /)).toBeInTheDocument();
    expect(screen.queryByText('Current thresholds')).toBeNull();
    expect(screen.getByLabelText('Vehicle rule history')).toHaveTextContent('pending from');
  });

  it('states that the after-hours window wraps midnight', async () => {
    render(<VehicleRulesDialog open onClose={vi.fn()} canEdit />);
    expect(await screen.findByText(/wraps midnight/i)).toBeInTheDocument();
  });

  it('hides the editor entirely without edit permission, but still shows history', async () => {
    render(<VehicleRulesDialog open onClose={vi.fn()} canEdit={false} />);
    await waitFor(() => expect(screen.getByLabelText('Vehicle rule history')).toHaveTextContent('Version 2'));
    expect(screen.queryByLabelText('Create vehicle rule version')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create vehicle rule version' })).toBeNull();
  });

  it('submits a new version with every field and the trimmed reason', async () => {
    render(<VehicleRulesDialog open onClose={vi.fn()} canEdit />);
    fireEvent.change(await screen.findByLabelText('Theft displacement (metres)'), { target: { value: '750' } });
    fireEvent.change(screen.getByLabelText('Harsh braking threshold (g)'), { target: { value: '0.4' } });
    fireEvent.click(screen.getByLabelText('Public holidays are after-hours'));
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2099-01-01T02:00' } });
    fireEvent.change(screen.getByLabelText('Change reason'), { target: { value: '  Tighter theft threshold  ' } });

    expect(screen.getByLabelText('Vehicle rule change summary')).toHaveTextContent('Theft displacement: 500 m → 750 m');

    fetchMock.mockResolvedValueOnce(response({ ...current, id: 'rule-3', version: 3 }))
      .mockResolvedValueOnce(response([{ ...current, id: 'rule-3', version: 3 }, current, previous]));
    fireEvent.click(screen.getByRole('button', { name: 'Create vehicle rule version' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const post = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(post.method).toBe('POST');
    expect(JSON.parse(String(post.body))).toMatchObject({
      timezone: 'Africa/Johannesburg', theftDisplacementMeters: 750, harshLinearG: 0.4,
      theftMinPositions: 2, lostContactMinutes: 30, knownSiteRadiusMeters: 500,
      afterHoursStartTime: '21:00', afterHoursEndTime: '05:00',
      weekendsAreAfterHours: true, publicHolidaysAreAfterHours: false,
      changeReason: 'Tighter theft threshold',
    });
  });

  it('refuses to submit without a reason', async () => {
    render(<VehicleRulesDialog open onClose={vi.fn()} canEdit />);
    await screen.findByLabelText('Theft displacement (metres)');
    expect(screen.getByRole('button', { name: 'Create vehicle rule version' })).toBeDisabled();
  });

  it('refuses a single-fix theft threshold — one GPS blip is not a theft', async () => {
    render(<VehicleRulesDialog open onClose={vi.fn()} canEdit />);
    const input = await screen.findByLabelText('Theft minimum positions (fixes)');
    expect(input).toHaveAttribute('min', '2');
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Change reason'), { target: { value: 'Unsafe single fix' } });
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2099-01-01T02:00' } });
    expect(screen.getByText('Use a whole number of at least 2.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create vehicle rule version' })).toBeDisabled();
  });

  it.each([
    ['Harsh braking threshold (g)', '-0.1', 'Use a non-negative number.'],
    ['Unauthorised stop (minutes)', '0', 'Use a whole number of at least 1.'],
    ['Known site radius (metres)', '0', 'Use a whole number of at least 1.'],
    ['Idle alert (minutes)', '2.5', 'Use a whole number of at least 1.'],
  ])('refuses %s = %s', async (label, value, message) => {
    render(<VehicleRulesDialog open onClose={vi.fn()} canEdit />);
    fireEvent.change(await screen.findByLabelText(label), { target: { value } });
    fireEvent.change(screen.getByLabelText('Change reason'), { target: { value: 'Out of range' } });
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2099-01-01T02:00' } });
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create vehicle rule version' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a backdated activation', async () => {
    render(<VehicleRulesDialog open onClose={vi.fn()} canEdit />);
    await screen.findByLabelText('Effective from');
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2020-01-01T00:00' } });
    fireEvent.change(screen.getByLabelText('Change reason'), { target: { value: 'Backdated change' } });
    expect(screen.getByRole('button', { name: 'Create vehicle rule version' })).toBeDisabled();
  });

  it('surfaces a failed save instead of pretending it worked', async () => {
    render(<VehicleRulesDialog open onClose={vi.fn()} canEdit />);
    await screen.findByLabelText('Theft displacement (metres)');
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2099-01-01T02:00' } });
    fireEvent.change(screen.getByLabelText('Change reason'), { target: { value: 'Will fail' } });
    fetchMock.mockResolvedValueOnce(response(null, false, 400, 'effectiveFrom must be after the current rule activation'));
    fireEvent.click(screen.getByRole('button', { name: 'Create vehicle rule version' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('effectiveFrom must be after the current rule activation');
  });
});

/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getMyFleetIncident: vi.fn(),
  linkMyAttendanceCorrection: vi.fn(),
  fetchAttendanceCorrectionEligibility: vi.fn(),
  DriverIncidentApiError: class DriverIncidentApiError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); this.name = 'DriverIncidentApiError'; }
  },
}));
vi.mock('../driverIncidentApi', () => api);

vi.mock('../AttendanceCorrectionLink', () => ({
  AttendanceCorrectionLink: ({ incidentId }: { incidentId: string }) => <div data-testid="attendance-correction-link">{incidentId}</div>,
}));

vi.mock('../DriverResponseForm', () => ({
  DriverResponseForm: ({ incidentId }: { incidentId: string }) => <form data-testid="driver-response-form">{incidentId}</form>,
}));

import { DriverIncidentDetail } from '../DriverIncidentDetail';

const INCIDENT = '11111111-1111-4111-8111-111111111111';
const CORRECTION = '55555555-5555-4555-8555-555555555555';
const NO_RETRY_ELIGIBILITY = { eligible: false as const, reason: 'no_required_exception' as const, retryCorrectionId: null };

const BASE_DETAIL = {
  id: INCIDENT, incidentReference: 'INC-LATE-20260810-ABC123', neutralLabel: 'Attendance timing needs review',
  projectLabel: 'Corridor A', siteLabel: 'Site 4', detectedAt: '2026-08-10T08:00:00.000Z', conditionState: 'active',
  lifecyclePresentation: 'Open', driverInputState: 'requested',
  currentRequest: { id: 'req-1', guidance: 'Please confirm your location.', requestedAt: '2026-08-10T09:00:00.000Z', respondBy: '2026-08-12T21:59:59.999Z' },
  respondedAt: null, explanationSummary: null,
  timeline: [{ id: 't1', kind: 'request', visibility: 'shared_with_driver', occurredAt: '2026-08-10T09:00:00.000Z', label: 'Input requested', note: null }],
  ownSubmissions: [], ownCorrectionLinks: [], responseEligible: true, responseIneligibleReason: null,
  enabledConcernCategories: ['other'],
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => {
  vi.clearAllMocks();
  api.fetchAttendanceCorrectionEligibility.mockResolvedValue(NO_RETRY_ELIGIBILITY);
});

describe('DriverIncidentDetail', () => {
  it('shows a loading state before the fetch resolves', () => {
    api.getMyFleetIncident.mockReturnValue(new Promise(() => {}));
    render(<DriverIncidentDetail incidentId={INCIDENT} />);
    expect(screen.getByText(/loading/i)).toBeVisible();
  });

  it('renders the neutral label, reference, project/site, and visible timeline', async () => {
    api.getMyFleetIncident.mockResolvedValue(BASE_DETAIL);
    render(<DriverIncidentDetail incidentId={INCIDENT} />);

    expect(await screen.findByText('INC-LATE-20260810-ABC123')).toBeVisible();
    expect(screen.getByText('Attendance timing needs review')).toBeVisible();
    expect(screen.getByText(/Corridor A/)).toBeVisible();
    // Appears twice by design: the driver-input-state badge AND the timeline entry both say "Input requested".
    expect(screen.getAllByText('Input requested').length).toBeGreaterThanOrEqual(2);
  });

  it('mounts the response form when the incident currently accepts a response', async () => {
    api.getMyFleetIncident.mockResolvedValue(BASE_DETAIL);
    render(<DriverIncidentDetail incidentId={INCIDENT} />);
    expect(await screen.findByTestId('driver-response-form')).toBeVisible();
  });

  it('shows neutral ineligible copy instead of the response form when the window has closed', async () => {
    api.getMyFleetIncident.mockResolvedValue({ ...BASE_DETAIL, responseEligible: false, responseIneligibleReason: 'expired' });
    render(<DriverIncidentDetail incidentId={INCIDENT} />);

    expect(await screen.findByText(/window to respond.*closed/i)).toBeVisible();
    expect(screen.queryByTestId('driver-response-form')).not.toBeInTheDocument();
  });

  it('mounts the Attendance correction affordance', async () => {
    api.getMyFleetIncident.mockResolvedValue(BASE_DETAIL);
    render(<DriverIncidentDetail incidentId={INCIDENT} />);
    expect(await screen.findByTestId('attendance-correction-link')).toBeVisible();
  });

  it('shows an explicit not-found state (never confirming vs denying another driver\'s incident) on a 404', async () => {
    api.getMyFleetIncident.mockRejectedValue(new api.DriverIncidentApiError(404, 'NOT_FOUND', 'Incident not found'));
    render(<DriverIncidentDetail incidentId={INCIDENT} />);
    expect(await screen.findByText(/not found/i)).toBeVisible();
  });

  it('shows an explicit API-error state — never rendered as an empty page', async () => {
    api.getMyFleetIncident.mockRejectedValue(new api.DriverIncidentApiError(500, 'INTERNAL_ERROR', 'db down'));
    render(<DriverIncidentDetail incidentId={INCIDENT} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not load/i);
  });

  it('never renders internal incident fields or disciplinary wording', async () => {
    api.getMyFleetIncident.mockResolvedValue(BASE_DETAIL);
    const { container } = render(<DriverIncidentDetail incidentId={INCIDENT} />);
    await screen.findByText('INC-LATE-20260810-ABC123');

    expect(container.textContent).not.toMatch(/theft_after_hours_movement|accident_sos|incidentType|severity|recipient|coordinate/i);
    expect(container.textContent).not.toMatch(/violation|fraud|misconduct|offence/i);
  });

  describe('Attendance correction link retry (server-derived, closing the known navigate-away gap)', () => {
    it('offers no retry section when the server reports nothing to retry', async () => {
      api.getMyFleetIncident.mockResolvedValue(BASE_DETAIL);
      api.fetchAttendanceCorrectionEligibility.mockResolvedValue(NO_RETRY_ELIGIBILITY);
      render(<DriverIncidentDetail incidentId={INCIDENT} />);
      await screen.findByText('INC-LATE-20260810-ABC123');
      expect(screen.queryByRole('button', { name: /retry linking/i })).not.toBeInTheDocument();
    });

    it('offers no retry section when the incident is fully eligible for a new correction', async () => {
      api.getMyFleetIncident.mockResolvedValue(BASE_DETAIL);
      api.fetchAttendanceCorrectionEligibility.mockResolvedValue({ eligible: true, exceptionId: 'exc-1', entryId: 'entry-1' });
      render(<DriverIncidentDetail incidentId={INCIDENT} />);
      await screen.findByText('INC-LATE-20260810-ABC123');
      expect(screen.queryByRole('button', { name: /retry linking/i })).not.toBeInTheDocument();
    });

    it('offers a retry when the server reports a submitted correction not yet linked to this incident', async () => {
      api.getMyFleetIncident.mockResolvedValue(BASE_DETAIL);
      api.fetchAttendanceCorrectionEligibility.mockResolvedValue({
        eligible: false, reason: 'no_required_exception', retryCorrectionId: CORRECTION,
      });
      render(<DriverIncidentDetail incidentId={INCIDENT} />);

      expect(await screen.findByRole('button', { name: /retry linking/i })).toBeVisible();
    });

    it('re-attempts the link with the server-reported correction id and hides the panel on success', async () => {
      api.getMyFleetIncident.mockResolvedValue(BASE_DETAIL);
      api.fetchAttendanceCorrectionEligibility.mockResolvedValue({
        eligible: false, reason: 'no_required_exception', retryCorrectionId: CORRECTION,
      });
      api.linkMyAttendanceCorrection.mockResolvedValue({
        linkId: 'link-1', incidentId: INCIDENT, attendanceCorrectionId: CORRECTION, correctionState: 'pending',
      });
      const user = userEvent.setup();
      render(<DriverIncidentDetail incidentId={INCIDENT} />);

      await user.click(await screen.findByRole('button', { name: /retry linking/i }));

      await waitFor(() => expect(api.linkMyAttendanceCorrection).toHaveBeenCalledWith(INCIDENT, CORRECTION));
      expect(screen.getByText(/linked/i)).toBeVisible();
      expect(screen.queryByRole('button', { name: /retry linking/i })).not.toBeInTheDocument();
    });

    it('lets the driver retry again when the retry itself fails, without discarding the retryable correction id', async () => {
      api.getMyFleetIncident.mockResolvedValue(BASE_DETAIL);
      api.fetchAttendanceCorrectionEligibility.mockResolvedValue({
        eligible: false, reason: 'no_required_exception', retryCorrectionId: CORRECTION,
      });
      api.linkMyAttendanceCorrection.mockRejectedValue(new api.DriverIncidentApiError(500, 'INTERNAL_ERROR', 'still failing'));
      const user = userEvent.setup();
      render(<DriverIncidentDetail incidentId={INCIDENT} />);

      await user.click(await screen.findByRole('button', { name: /retry linking/i }));

      await waitFor(() => expect(api.linkMyAttendanceCorrection).toHaveBeenCalledTimes(1));
      expect(await screen.findByRole('button', { name: /retry linking/i })).toBeVisible();
      expect(screen.getByText(/still failing/i)).toBeVisible();
    });
  });
});

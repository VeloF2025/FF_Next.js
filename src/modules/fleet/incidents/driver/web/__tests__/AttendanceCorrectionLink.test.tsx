/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AttendanceCorrectionLink,
  fetchAttendanceCorrectionEligibility,
  linkAttendanceCorrection,
} from '../AttendanceCorrectionLink';

const INCIDENT = '22222222-2222-4222-8222-222222222222';
const CORRECTION = '55555555-5555-4555-8555-555555555555';

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AttendanceCorrectionLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('links to the correction form with the exception and incident ids when eligible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ success: true, data: { eligible: true, exceptionId: 'exc-1', entryId: 'entry-1' } }),
    ));

    render(<AttendanceCorrectionLink incidentId={INCIDENT} />);

    const link = await screen.findByRole('link', { name: /correct attendance/i });
    expect(link).toHaveAttribute(
      'href',
      `/my/attendance/corrections/new?exception_id=exc-1&incident_id=${INCIDENT}`,
    );
  });

  it('renders neutral copy and no link when no attendance exception currently requires correction', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ success: true, data: { eligible: false, reason: 'no_required_exception' } }),
    ));

    render(<AttendanceCorrectionLink incidentId={INCIDENT} />);

    await waitFor(() => expect(screen.queryByText(/checking attendance correction/i)).not.toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /correct attendance/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no attendance correction is currently required/i)).toBeVisible();
  });

  it('renders neutral copy for a locked payroll period, with no accusatory or internal language', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ success: true, data: { eligible: false, reason: 'period_locked' } }),
    ));

    render(<AttendanceCorrectionLink incidentId={INCIDENT} />);

    const copy = await screen.findByText(/attendance period.*locked/i);
    expect(copy.textContent).not.toMatch(/fraud|misconduct|violation|theft/i);
  });

  it('renders neutral copy when the response window has closed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ success: true, data: { eligible: false, reason: 'outside_response_window' } }),
    ));

    render(<AttendanceCorrectionLink incidentId={INCIDENT} />);

    expect(await screen.findByText(/window.*closed/i)).toBeVisible();
  });

  it('shows a loading state before the eligibility check resolves', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));

    render(<AttendanceCorrectionLink incidentId={INCIDENT} />);

    expect(screen.getByText(/checking attendance correction/i)).toBeVisible();
  });

  it('shows an explicit error state on fetch failure rather than an empty view', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    render(<AttendanceCorrectionLink incidentId={INCIDENT} />);

    expect(await screen.findByRole('alert')).toBeVisible();
  });
});

describe('fetchAttendanceCorrectionEligibility', () => {
  it('GETs the incident-scoped eligibility endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, data: { eligible: true, exceptionId: 'exc-1', entryId: 'entry-1' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAttendanceCorrectionEligibility(INCIDENT)).resolves.toEqual({
      eligible: true, exceptionId: 'exc-1', entryId: 'entry-1',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/my/fleet/incidents/${INCIDENT}/attendance-correction-link`,
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('rejects when the API responds with a failure envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ success: false, error: { code: 'NOT_FOUND', message: 'Incident not found' } }, 404),
    ));

    await expect(fetchAttendanceCorrectionEligibility(INCIDENT)).rejects.toThrow(/incident not found/i);
  });
});

describe('linkAttendanceCorrection', () => {
  it('POSTs the attendanceCorrectionId to the incident-scoped link endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true, data: { linkId: 'link-1', incidentId: INCIDENT, attendanceCorrectionId: CORRECTION, correctionState: 'pending' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(linkAttendanceCorrection(INCIDENT, CORRECTION)).resolves.toEqual({
      linkId: 'link-1', incidentId: INCIDENT, attendanceCorrectionId: CORRECTION, correctionState: 'pending',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/my/fleet/incidents/${INCIDENT}/attendance-correction-link`,
      expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify({ attendanceCorrectionId: CORRECTION }) }),
    );
  });

  it('rejects (so the caller can offer retry) when the link request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Could not persist the link' } }, 500),
    ));

    await expect(linkAttendanceCorrection(INCIDENT, CORRECTION)).rejects.toThrow(/could not persist the link/i);
  });
});

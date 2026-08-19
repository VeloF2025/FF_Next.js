/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IncidentReviewDrawer } from '../IncidentReviewDrawer';
import type { IncidentDetail } from '../../types';

function detail(overrides: Partial<IncidentDetail> = {}): IncidentDetail {
  return {
    id: 'incident-1', incidentReference: 'FL-0001', incidentType: 'late', severity: 'high', lifecycleStatus: 'under_review',
    staffId: 'staff-1', staffName: 'Jane Driver', projectId: 'project-1', projectName: 'Lawley',
    operationalSiteName: 'Zone A', openedAt: '2026-08-18T07:00:00.000Z', conditionLastSeenAt: '2026-08-18T07:55:00.000Z',
    conditionClearedAt: null, escalationLevel: 0, nextEscalationAt: null, evidenceCount: 0,
    detectedAt: '2026-08-18T06:58:00.000Z', acknowledgedAt: '2026-08-18T07:05:00.000Z', acknowledgedBy: 'user-9',
    reviewStartedAt: '2026-08-18T07:10:00.000Z', reviewStartedBy: 'user-9', resolvedAt: null, resolvedBy: null,
    outcome: null, resolutionNote: null, evidenceSnapshot: { arrival_dwell_minutes: 22, gps_freshness_seconds: 45 },
    sourceEventId: null, linkedHsReference: 'HS-77', linkedMaintenanceReference: null,
    actions: [{ id: 'action-1', actionType: 'opened', actorUserId: null, isSystemActor: true, occurredAt: '2026-08-18T06:58:00.000Z', note: null, beforeLifecycleStatus: null, afterLifecycleStatus: 'open', beforeEscalationLevel: null, afterEscalationLevel: 0, metadata: {}, requestCorrelationId: null }],
    evidence: [{ id: 'evidence-1', evidenceType: 'photo', storageUrl: '/storage/fleet/incidents/photo.jpg', storageKey: 'k', mimeType: 'image/jpeg', originalFilename: 'gate.jpg', uploadedBy: 'user-9', description: 'Gate photo', createdAt: '2026-08-18T07:12:00.000Z' }],
    delivery: { delivered: 2, suppressed: 0, failed: 0 },
    ...overrides,
  };
}

function ok(data: unknown, status = 200): Response { return { ok: true, status, json: async () => ({ success: true, data }) } as Response; }
function fail(status: number, code: string, message: string): Response { return { ok: false, status, json: async () => ({ success: false, error: { code, message } }) } as Response; }
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function flush(): Promise<void> { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); });

describe('IncidentReviewDrawer', () => {
  it('presents snapshot identity/schedule, reasons/freshness, history, delivery, attachments, and the linked H&S reference', async () => {
    fetchMock.mockResolvedValue(ok(detail()));
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();

    expect(screen.getByText('Jane Driver')).toBeInTheDocument();
    expect(screen.getByText(/Lawley/)).toBeInTheDocument();
    expect(screen.getByText(/arrival dwell minutes: 22/)).toBeInTheDocument();
    expect(screen.getByText(/2 delivered/)).toBeInTheDocument();
    expect(screen.getByText('HS-77')).toBeInTheDocument();
    expect(screen.getByText('gate.jpg')).toBeInTheDocument();
    expect(screen.getByText(/opened/)).toBeInTheDocument();
  });

  it('shows only acknowledge/comment for an open incident', async () => {
    fetchMock.mockResolvedValue(ok(detail({ lifecycleStatus: 'open' })));
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();
    expect(screen.getByRole('button', { name: 'acknowledged' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'commented' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'resolved' })).not.toBeInTheDocument();
  });

  it('reflects the lifecycle matrix for a resolved incident: no action controls at all', async () => {
    fetchMock.mockResolvedValue(ok(detail({ lifecycleStatus: 'resolved', outcome: 'confirmed', resolutionNote: 'Confirmed late arrival' })));
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();
    expect(screen.getByText(/This incident is closed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'acknowledged' })).not.toBeInTheDocument();
  });

  it('requires an outcome and a note before a resolution can be submitted', async () => {
    fetchMock.mockResolvedValue(ok(detail({ lifecycleStatus: 'under_review' })));
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'resolved' }));
    const submit = screen.getByRole('button', { name: 'Submit' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Confirmed against attendance' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'confirmed' } });
    expect(submit).toBeEnabled();
  });

  it('blocks terminal submission on an evidence-required outcome but retains the entered note/outcome so the manager can attach evidence and retry', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/actions') && init?.method === 'POST') {
        return Promise.resolve(fail(400, 'BAD_REQUEST', 'Outcome confirmed requires at least one evidence attachment'));
      }
      return Promise.resolve(ok(detail({ lifecycleStatus: 'under_review' })));
    });
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'resolved' }));
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'confirmed' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Confirmed against attendance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await flush();

    expect(screen.getByRole('alert')).toHaveTextContent('requires at least one evidence attachment');
    expect(screen.getByLabelText('Note')).toHaveValue('Confirmed against attendance');
    expect(screen.getByLabelText('Outcome')).toHaveValue('confirmed');
  });

  it('never blocks acknowledgement on an evidence requirement — acknowledgement succeeds only after the API confirms it', async () => {
    const ackDeferred = deferred<Response>();
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/actions') && init?.method === 'POST') return ackDeferred.promise;
      return Promise.resolve(ok(detail({ lifecycleStatus: 'open' })));
    });
    const onChanged = vi.fn();
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={onChanged} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'acknowledged' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await flush();

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();

    await act(async () => { ackDeferred.resolve(ok({ incidentId: 'incident-1', lifecycleStatus: 'acknowledged', actionId: 'action-2' })); await ackDeferred.promise; });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('hides every action control for a viewer without edit permission', async () => {
    fetchMock.mockResolvedValue(ok(detail({ lifecycleStatus: 'open' })));
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit={false} returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();
    expect(screen.getByText(/You do not have permission to act on this incident/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'acknowledged' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request driver input' })).not.toBeInTheDocument();
  });

  it('shows "Awaiting driver" once a manager requests input, and "Driver responded" once a submission follows the request', async () => {
    const opened = {
      id: 'action-1', actionType: 'opened' as const, actorUserId: null, isSystemActor: true,
      occurredAt: '2026-08-18T06:58:00.000Z', note: null, beforeLifecycleStatus: null, afterLifecycleStatus: 'open' as const,
      beforeEscalationLevel: null, afterEscalationLevel: 0, metadata: {}, requestCorrelationId: null,
    };
    const requested = {
      id: 'action-2', actionType: 'driver_input_requested' as const, actorUserId: 'user-9', isSystemActor: false,
      occurredAt: '2026-08-18T07:00:00.000Z', note: 'Please explain the late start', beforeLifecycleStatus: 'open' as const,
      afterLifecycleStatus: 'open' as const, beforeEscalationLevel: 0, afterEscalationLevel: 0, metadata: {}, requestCorrelationId: null,
    };
    const responded = {
      id: 'action-3', actionType: 'driver_response_received' as const, actorUserId: null, isSystemActor: false,
      occurredAt: '2026-08-18T09:00:00.000Z', note: null, beforeLifecycleStatus: 'open' as const, afterLifecycleStatus: 'open' as const,
      beforeEscalationLevel: 0, afterEscalationLevel: 0, metadata: {}, requestCorrelationId: null,
    };

    fetchMock.mockResolvedValueOnce(ok(detail({ actions: [requested, opened] })));
    const { unmount } = render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();
    expect(screen.getByText('Awaiting driver')).toBeInTheDocument();
    expect(screen.queryByText('Driver responded')).not.toBeInTheDocument();
    // Authorship is distinguishable in the activity history, not just a raw action-type label.
    expect(screen.getByText(/Requested driver input/)).toBeInTheDocument();
    unmount();

    fetchMock.mockResolvedValueOnce(ok(detail({ actions: [responded, requested, opened] })));
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();
    expect(screen.getByText('Driver responded')).toBeInTheDocument();
    expect(screen.queryByText('Awaiting driver')).not.toBeInTheDocument();
  });

  it('shows no driver-input badge when input was never requested', async () => {
    fetchMock.mockResolvedValue(ok(detail()));
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();
    expect(screen.queryByText('Awaiting driver')).not.toBeInTheDocument();
    expect(screen.queryByText('Driver responded')).not.toBeInTheDocument();
  });

  it('lets an editor request driver input and confirms the response-due date only after the API confirms it', async () => {
    const requestDeferred = deferred<Response>();
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/request-driver-input') && init?.method === 'POST') return requestDeferred.promise;
      return Promise.resolve(ok(detail({ lifecycleStatus: 'open' })));
    });
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();

    fireEvent.change(screen.getByLabelText('Driver guidance'), { target: { value: 'Please explain the late start' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request driver input' }));
    await flush();

    expect(screen.getByRole('button', { name: 'Requesting…' })).toBeInTheDocument();
    expect(screen.queryByText(/Requested — response due/)).not.toBeInTheDocument();

    await act(async () => {
      requestDeferred.resolve(ok({
        inputRequestId: 'req-1', incidentId: 'incident-1', respondBy: '2026-08-20T21:59:59.999Z',
        driverInputState: 'requested', notification: { delivered: 1, suppressed: 0, failed: 0 },
      }));
      await requestDeferred.promise;
    });
    await waitFor(() => expect(screen.getByText(/Requested — response due/)).toBeInTheDocument());
  });

  it('surfaces a request-driver-input failure without losing the entered guidance', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/request-driver-input') && init?.method === 'POST') return Promise.resolve(fail(409, 'CONFLICT', 'Incident is closed and driver input can no longer be requested'));
      return Promise.resolve(ok(detail({ lifecycleStatus: 'open' })));
    });
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();

    fireEvent.change(screen.getByLabelText('Driver guidance'), { target: { value: 'Please explain' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request driver input' }));
    await flush();

    expect(screen.getByRole('alert')).toHaveTextContent('Incident is closed and driver input can no longer be requested');
    expect(screen.getByLabelText('Driver guidance')).toHaveValue('Please explain');
  });

  it('does not render driver-input status or the request action when the incident cannot be loaded (cross-project PM)', async () => {
    fetchMock.mockResolvedValue(fail(403, 'FORBIDDEN', 'You cannot view this incident'));
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();
    expect(screen.getByText('You cannot view this incident.')).toBeInTheDocument();
    expect(screen.queryByText('Awaiting driver')).not.toBeInTheDocument();
    expect(screen.queryByText('Driver responded')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request driver input' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Driver guidance')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    fetchMock.mockResolvedValue(ok(detail()));
    const onClose = vi.fn();
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={onClose} onChanged={vi.fn()} />);
    await flush();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    actions: [{ id: 'action-1', actionType: 'opened', actorUserId: null, isSystemActor: true, occurredAt: '2026-08-18T06:58:00.000Z', note: null, visibility: 'internal', beforeLifecycleStatus: null, afterLifecycleStatus: 'open', beforeEscalationLevel: null, afterEscalationLevel: 0, metadata: {}, requestCorrelationId: null }],
    evidence: [{ id: 'evidence-1', evidenceType: 'photo', storageUrl: '/storage/fleet/incidents/photo.jpg', storageKey: 'k', mimeType: 'image/jpeg', originalFilename: 'gate.jpg', uploadedBy: 'user-9', description: 'Gate photo', visibility: 'internal', createdAt: '2026-08-18T07:12:00.000Z' }],
    delivery: { delivered: 2, suppressed: 0, failed: 0 },
    driverInput: { state: 'not_requested', respondBy: null, deliveryFailed: false },
    correctionLinks: [],
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
/**
 * The drawer loads its chronology on a second request (stage 8, task 6). These
 * tests are about the drawer, so that request is answered with an empty page
 * here rather than being left to consume each test's own `mockResolvedValue` —
 * `IncidentTimeline.test.tsx` is where the chronology itself is tested.
 */
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', (url: RequestInfo | URL, init?: RequestInit) => {
    // Same reasoning as the chronology above: the drawer now also mounts the
    // retention-hold panel, which loads on its own request. Answered with an
    // unheld incident here so it never consumes a test's own
    // `mockResolvedValue`; `RetentionHoldPanel.test.tsx` tests the panel.
    if (String(url).includes('/timeline')) return Promise.resolve(ok({ entries: [], nextCursor: null }));
    if (String(url).includes('/retention-holds')) return Promise.resolve(ok({ holds: [], actions: [], canManage: false, canCreate: false }));
    return fetchMock(url as RequestInfo, init);
  });
});

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
      occurredAt: '2026-08-18T06:58:00.000Z', note: null, visibility: 'internal' as const, beforeLifecycleStatus: null, afterLifecycleStatus: 'open' as const,
      beforeEscalationLevel: null, afterEscalationLevel: 0, metadata: {}, requestCorrelationId: null,
    };
    const requested = {
      id: 'action-2', actionType: 'driver_input_requested' as const, actorUserId: 'user-9', isSystemActor: false,
      occurredAt: '2026-08-18T07:00:00.000Z', note: 'Please explain the late start', visibility: 'shared_with_driver' as const, beforeLifecycleStatus: 'open' as const,
      afterLifecycleStatus: 'open' as const, beforeEscalationLevel: 0, afterEscalationLevel: 0, metadata: {}, requestCorrelationId: null,
    };
    const responded = {
      id: 'action-3', actionType: 'driver_response_received' as const, actorUserId: null, isSystemActor: false,
      occurredAt: '2026-08-18T09:00:00.000Z', note: 'I was on site the whole time', visibility: 'driver_submitted' as const,
      beforeLifecycleStatus: 'open' as const, afterLifecycleStatus: 'open' as const,
      beforeEscalationLevel: 0, afterEscalationLevel: 0, metadata: {}, requestCorrelationId: null,
    };

    fetchMock.mockResolvedValueOnce(ok(detail({
      actions: [requested, opened],
      driverInput: { state: 'requested', respondBy: '2026-08-20T21:59:59.999Z', deliveryFailed: false },
    })));
    const { unmount } = render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();
    expect(screen.getByText('Awaiting driver')).toBeInTheDocument();
    expect(screen.queryByText('Driver responded')).not.toBeInTheDocument();
    // Authorship is distinguishable in the activity history, not just a raw action-type label.
    expect(screen.getByText(/Requested driver input/)).toBeInTheDocument();
    // Visibility is distinguishable per-row, not just per-badge: a manager-authored request
    // shared with the driver reads differently from an internal-only row.
    expect(within(screen.getByTestId('action-action-2')).getByText('[Shared with driver]')).toBeInTheDocument();
    unmount();

    fetchMock.mockResolvedValueOnce(ok(detail({
      actions: [responded, requested, opened],
      driverInput: { state: 'responded', respondBy: '2026-08-20T21:59:59.999Z', deliveryFailed: false },
    })));
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();
    expect(screen.getByText('Driver responded')).toBeInTheDocument();
    expect(screen.queryByText('Awaiting driver')).not.toBeInTheDocument();
    // Critical: the driver's own submitted words must be readable verbatim by the manager,
    // not just a "Driver responded" badge with no content.
    const respondedRow = screen.getByTestId('action-action-3');
    expect(within(respondedRow).getByText(/I was on site the whole time/)).toBeInTheDocument();
    expect(within(respondedRow).getByText('[Driver submitted]')).toBeInTheDocument();
  });

  it('shows no driver-input badge when input was never requested', async () => {
    fetchMock.mockResolvedValue(ok(detail()));
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();
    expect(screen.queryByText('Awaiting driver')).not.toBeInTheDocument();
    expect(screen.queryByText('Driver responded')).not.toBeInTheDocument();
  });

  /**
   * PR7 review I2: the previous badge derived only from action ordering and could not tell
   * "response window closed" from "driver hasn't answered yet" — both rendered as "Awaiting
   * driver". `driverInput.state` now comes straight from `deriveDriverInputState`, so expired
   * and closed each get their own, distinct badge text.
   */
  it('distinguishes an expired response window and a closed incident from "Awaiting driver"', async () => {
    fetchMock.mockResolvedValueOnce(ok(detail({ driverInput: { state: 'expired', respondBy: '2026-08-15T21:59:59.999Z', deliveryFailed: false } })));
    const { unmount } = render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();
    expect(screen.getByText('Response window expired')).toBeInTheDocument();
    expect(screen.queryByText('Awaiting driver')).not.toBeInTheDocument();
    unmount();

    fetchMock.mockResolvedValueOnce(ok(detail({ lifecycleStatus: 'resolved', outcome: 'confirmed', resolutionNote: 'Confirmed late arrival', driverInput: { state: 'closed', respondBy: null, deliveryFailed: false } })));
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();
    expect(screen.getByText('Response window closed')).toBeInTheDocument();
    expect(screen.queryByText('Awaiting driver')).not.toBeInTheDocument();
  });

  /** PR7 review I3: `respond_by` and the delivery-failure counter were durably stored but never read anywhere a manager could see them. */
  it('surfaces the response due date for an open request and a delivery-failure warning', async () => {
    fetchMock.mockResolvedValueOnce(ok(detail({ driverInput: { state: 'requested', respondBy: '2026-08-20T21:59:59.999Z', deliveryFailed: false } })));
    const { unmount } = render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();
    expect(screen.getByText(/Response due/)).toBeInTheDocument();
    expect(screen.queryByText(/was not notified/)).not.toBeInTheDocument();
    unmount();

    fetchMock.mockResolvedValueOnce(ok(detail({ driverInput: { state: 'requested', respondBy: '2026-08-20T21:59:59.999Z', deliveryFailed: true } })));
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent(/was not notified/);
  });

  /** PR7 review C1: correction links were written by the driver-scoped `/my` portal and read only there — no manager surface existed at all. */
  it('renders correction-link status for a manager, read live from Attendance', async () => {
    fetchMock.mockResolvedValue(ok(detail({
      correctionLinks: [{ id: 'link-1', attendanceCorrectionId: 'adj-1', linkedAt: '2026-08-18T09:05:00.000Z', correctionState: 'approved' }],
    })));
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();
    expect(within(screen.getByTestId('correction-link-link-1')).getByText(/Approved/)).toBeInTheDocument();
  });

  it('renders nothing for the correction-links section when none exist', async () => {
    fetchMock.mockResolvedValue(ok(detail({ correctionLinks: [] })));
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();
    expect(screen.queryByLabelText('Attendance corrections')).not.toBeInTheDocument();
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

  // NOTE: this only proves the drawer renders nothing when the detail fetch 403s — the
  // whole drawer body is gated on `detail` being non-null regardless of driver-input content,
  // so it does not exercise the manager project-scope boundary itself. That boundary (a PM
  // cannot read another PM's incident, including its driver response) is enforced in
  // `reviewService.ts#getIncidentDetailForViewer` and proven server-side in
  // `reviewService.test.ts`, where `getIncidentActions` — the only place a driver's
  // submitted explanation is read from — is asserted never called once scope denies access.
  it('does not render driver-input status or the request action when the detail fetch is denied (403)', async () => {
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

  it('adds the chronology beside the existing sections rather than in place of them', async () => {
    fetchMock.mockResolvedValue(ok(detail({ lifecycleStatus: 'open' })));
    render(<IncidentReviewDrawer incidentId="incident-1" canEdit returnFocus={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    await flush();
    expect(screen.getByRole('region', { name: 'Incident chronology' })).toBeInTheDocument();
    // The sections the chronology deliberately does not duplicate — it carries no
    // bodies, so these remain the only place a manager reads one.
    expect(screen.getByRole('region', { name: 'Activity history' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Attachments' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'acknowledged' })).toBeInTheDocument();
  });
});

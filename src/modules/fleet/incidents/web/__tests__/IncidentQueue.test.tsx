/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IncidentQueue } from '../IncidentQueue';
import type { IncidentListItem, IncidentListResult } from '../../types';

const NOW = '2026-08-18T08:00:00.000Z';

function incident(overrides: Partial<IncidentListItem> = {}): IncidentListItem {
  return {
    id: 'incident-1', incidentReference: 'FL-0001', incidentType: 'late', severity: 'high', lifecycleStatus: 'open',
    staffId: 'staff-1', staffName: 'Jane Driver', projectId: 'project-1', projectName: 'Lawley',
    operationalSiteName: 'Zone A', openedAt: '2026-08-18T07:00:00.000Z', conditionLastSeenAt: '2026-08-18T07:55:00.000Z',
    conditionClearedAt: null, escalationLevel: 0, nextEscalationAt: '2026-08-18T08:15:00.000Z', evidenceCount: 0,
    driverInput: { state: 'not_requested', respondBy: null, deliveryFailed: false },
    ...overrides,
  };
}

function listResult(incidents: IncidentListItem[]): IncidentListResult { return { incidents, total: incidents.length }; }

function ok(data: unknown, status = 200): Response {
  return { ok: true, status, json: async () => ({ success: true, data }) } as Response;
}
function fail(status: number, code: string, message: string): Response {
  return { ok: false, status, json: async () => ({ success: false, error: { code, message } }) } as Response;
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(NOW));
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState({}, '', '/fleet/incidents');
});

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('IncidentQueue', () => {
  it('shows a loading state, then rows with the approved fields and overdue acknowledgement semantics', async () => {
    fetchMock.mockResolvedValue(ok(listResult([
      incident(),
      incident({ id: 'incident-2', incidentReference: 'FL-0002', staffName: 'Sam Backup', lifecycleStatus: 'open', nextEscalationAt: '2026-08-18T07:59:00.000Z', escalationLevel: 1 }),
    ])));
    render(<IncidentQueue canEdit canManageSettings={false} />);
    expect(screen.getByText('Loading Fleet incidents…')).toBeInTheDocument();
    await flush();

    expect(screen.getByText('FL-0001')).toBeInTheDocument();
    expect(screen.getByText('Jane Driver')).toBeInTheDocument();
    expect(screen.getByText('Due in 15 min')).toBeInTheDocument();
    expect(screen.getByText(/Overdue \(escalation level 1\)/)).toBeInTheDocument();
  });

  it('shows a distinct API error state that keeps the queue actionable', async () => {
    fetchMock.mockResolvedValue(fail(503, 'SERVICE_UNAVAILABLE', 'Try again'));
    render(<IncidentQueue canEdit canManageSettings={false} />);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Fleet incidents could not be refreshed');
  });

  it('shows a distinct permission-denied state rather than a blank queue', async () => {
    fetchMock.mockResolvedValue(fail(403, 'FORBIDDEN', 'You cannot view Fleet incidents'));
    render(<IncidentQueue canEdit={false} canManageSettings={false} />);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have permission to view Fleet incidents.');
  });

  it('shows a no-incidents state when the queue is genuinely empty', async () => {
    fetchMock.mockResolvedValue(ok(listResult([])));
    render(<IncidentQueue canEdit canManageSettings={false} />);
    await flush();
    // Regex rather than an exact string because the copy now carries an
    // explanation, but the explanation itself is asserted too — a loosened
    // matcher that only checks the headline would pass on an empty state that
    // silently lost the "why is this empty?" text that makes it useful.
    const empty = screen.getByText(/No Fleet incidents right now/);
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toMatch(/operational status monitor/);
    expect(empty.textContent).toMatch(/fills in automatically/);
  });

  it('shows a distinct no-filter-results state when a filter excludes everything', async () => {
    fetchMock.mockResolvedValue(ok(listResult([])));
    window.history.replaceState({}, '', '/fleet/incidents?incidentType=late');
    render(<IncidentQueue canEdit canManageSettings={false} />);
    await flush();
    expect(screen.getByText('No incidents match the current filters.')).toBeInTheDocument();
    expect(screen.queryByText('No Fleet incidents right now.')).not.toBeInTheDocument();
  });

  it('seeds filters from the URL and updates the URL (and the request) when a filter changes', async () => {
    window.history.replaceState({}, '', '/fleet/incidents?incidentType=wrong_site&projectId=project-9&staffId=staff-9&conditionState=active&evidenceState=present&overdueOnly=true&fromDate=2026-08-01&toDate=2026-08-18');
    fetchMock.mockResolvedValue(ok(listResult([])));
    render(<IncidentQueue canEdit canManageSettings={false} />);
    await flush();
    // The Project/Staff id-filter pickers also call `fetch` on mount (resolving the
    // deep-linked id to a display name), so the incidents-list call is no longer
    // reliably `calls[0]` — find it by its own endpoint instead.
    const firstCall = String(fetchMock.mock.calls.map((call) => String(call[0])).find((url) => url.includes('/api/fleet/incidents?')));
    expect(firstCall).toContain('incidentType=wrong_site');
    expect(firstCall).toContain('projectId=project-9');
    expect(firstCall).toContain('staffId=staff-9');
    expect(firstCall).toContain('conditionState=active');
    expect(firstCall).toContain('evidenceState=present');
    expect(firstCall).toContain('overdueOnly=true');

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'acknowledged' } });
    await flush();
    expect(window.location.search).toContain('lifecycleStatus=acknowledged');
    const lastCall = String(fetchMock.mock.calls.at(-1)![0]);
    expect(lastCall).toContain('lifecycleStatus=acknowledged');
  });

  it('lets an editor select incidents for bulk acknowledgement and only clears the selection after the server confirms', async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('bulk-acknowledge')) return pending.promise;
      return Promise.resolve(ok(listResult([incident(), incident({ id: 'incident-2', incidentReference: 'FL-0002' })])));
    });
    const pending = deferred<Response>();
    render(<IncidentQueue canEdit canManageSettings={false} />);
    await flush();

    const row = screen.getByTestId('incident-row-incident-1');
    fireEvent.click(within(row).getByLabelText('Select incident FL-0001'));
    const ackButton = screen.getByRole('button', { name: 'Acknowledge selected (1)' });
    fireEvent.click(ackButton);
    await flush();

    expect(screen.getByRole('button', { name: 'Acknowledging…' })).toBeInTheDocument();
    expect(within(row).getByLabelText('Select incident FL-0001')).toBeChecked();

    await act(async () => { pending.resolve(ok({ results: [{ incidentId: 'incident-1', lifecycleStatus: 'acknowledged', actionId: 'action-1' }] })); await pending.promise; });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Acknowledge selected (0)' })).toBeInTheDocument());
  });

  it('never exposes bulk resolution/dismissal — only acknowledgement', async () => {
    fetchMock.mockResolvedValue(ok(listResult([incident()])));
    render(<IncidentQueue canEdit canManageSettings={false} />);
    await flush();
    expect(screen.queryByRole('button', { name: /resolve selected/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dismiss selected/i })).not.toBeInTheDocument();
  });

  it('hides the settings entry point unless the viewer is settings-authorized', async () => {
    fetchMock.mockResolvedValue(ok(listResult([])));
    const { rerender } = render(<IncidentQueue canEdit canManageSettings={false} />);
    await flush();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    rerender(<IncidentQueue canEdit canManageSettings />);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });
});

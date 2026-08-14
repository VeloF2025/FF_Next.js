/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationalAttentionRow } from '../../presentationTypes';
import type { OperationalEvidenceDetail } from '../../statusService';
import type { OperationalStatus } from '../../types';
import type { OperationalOverviewResponse } from '../operationsPresentationApi';
import { TodayOperations } from '../TodayOperations';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const WORK_DATE = '2026-08-13';
const AS_OF = '2026-08-13T08:00:00.000Z';
const ACTIONABLE: OperationalStatus[] = [
  'late', 'wrong_site', 'evidence_mismatch', 'left_early', 'unassigned', 'unverifiable',
  'vehicle_on_site_driver_unconfirmed',
];

function row(status: OperationalStatus, name: string): OperationalAttentionRow {
  const group = status === 'evidence_mismatch' ? 'mismatch'
    : status === 'vehicle_on_site_driver_unconfirmed' || status === 'unverifiable' ? 'unverifiable'
      : status as OperationalAttentionRow['group'];
  const staffId = `44444444-4444-4444-8444-${String(ACTIONABLE.indexOf(status) + 1).padStart(12, '0')}`;
  return {
    staffId,
    staffName: name,
    projectId: PROJECT_ID,
    projectName: 'Lawley',
    operationalSiteId: '22222222-2222-4222-8222-222222222222',
    operationalSiteName: 'Zone A',
    status,
    group,
    reasonCodes: [`${status}_reason`],
    reasonText: `${status.replaceAll('_', ' ')} reason`,
    flags: status === 'vehicle_on_site_driver_unconfirmed' ? ['vehicle_driver_presence_unconfirmed'] : [],
    evidenceLabel: status === 'vehicle_on_site_driver_unconfirmed'
      ? 'Vehicle on site; driver presence unconfirmed' : 'One evidence timestamp recorded',
    evidenceTimestamps: [AS_OF],
    durationSeconds: 600,
    ruleId: '33333333-3333-4333-8333-333333333333',
    ruleVersion: 4,
    actions: [{ id: 'view_evidence', staffId, projectId: PROJECT_ID }],
  };
}

const attentionRows = [
  row('late', 'Late Driver'),
  row('wrong_site', 'Wrong Site Driver'),
  row('evidence_mismatch', 'Mismatch Driver'),
  row('left_early', 'Left Early Driver'),
  row('unassigned', 'Unassigned Driver'),
  row('unverifiable', 'Unverifiable Driver'),
  row('vehicle_on_site_driver_unconfirmed', 'Vehicle Only Driver'),
];

function overview(overrides: Partial<OperationalOverviewResponse> = {}): OperationalOverviewResponse {
  return {
    selectionState: 'attention_available',
    groups: [
      { group: 'on_site', count: 2 }, { group: 'approaching', count: 1 },
      { group: 'late', count: 1 }, { group: 'wrong_site', count: 1 },
      { group: 'unverifiable', count: 2 }, { group: 'unassigned', count: 1 },
    ],
    attention: { items: attentionRows, page: 1, limit: 25, total: 7, hasMore: false },
    roster: { page: 1, limit: 100, total: 10, hasMore: false },
    workDate: WORK_DATE,
    evaluatedAt: AS_OF,
    rule: { id: '33333333-3333-4333-8333-333333333333', version: 4 },
    ...overrides,
  };
}

const detail: OperationalEvidenceDetail = {
  staffId: attentionRows[0]!.staffId,
  workDate: WORK_DATE,
  projectName: 'Lawley',
  operationalSiteName: 'Zone A',
  monitoringStart: '2026-08-13T04:00:00.000Z',
  scheduledStart: '2026-08-13T05:00:00.000Z',
  graceEnd: '2026-08-13T05:15:00.000Z',
  scheduledEnd: '2026-08-13T14:00:00.000Z',
  monitoringEnd: '2026-08-13T15:00:00.000Z',
  gpsStaleAfterSeconds: 300,
  evaluation: {
    status: 'late', flags: ['attendance_missing'], reasonCodes: ['arrival_not_confirmed'],
    ruleId: '33333333-3333-4333-8333-333333333333', ruleVersion: 4,
    sourceTimestamps: [AS_OF], thresholdsUsed: { graceMinutes: 15 },
  },
  points: [{ source: 'vehicle_latest', latitude: -26.2, longitude: 28.1, recordedAt: AS_OF }],
};

function ok(data: unknown): Response {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) } as Response;
}
function fail(status: number, code: string, message: string): Response {
  return { ok: false, status, json: async () => ({ success: false, error: { code, message } }) } as Response;
}
function installFetch(options: { overview?: OperationalOverviewResponse; overviewFailure?: Response; detailFailure?: Response } = {}) {
  global.fetch = vi.fn((input) => {
    const url = String(input);
    if (url.startsWith('/api/fleet/assignments/options')) {
      return Promise.resolve(ok({ staff: [], teams: [], projects: [{ id: PROJECT_ID, label: 'Lawley' }], sites: [], vehicles: [], siteSources: [] }));
    }
    if (url.startsWith('/api/fleet/operations/status/')) return Promise.resolve(options.detailFailure ?? ok(detail));
    if (url.startsWith('/api/fleet/operations/overview')) {
      if (options.overviewFailure) return Promise.resolve(options.overviewFailure);
      const group = new URL(url, 'http://localhost').searchParams.get('group');
      const data = options.overview ?? overview();
      return Promise.resolve(ok(group ? {
        ...data,
        attention: { ...data.attention, items: data.attention.items.filter((item) => item.group === group) },
      } : data));
    }
    throw new Error(`Unexpected request: ${url}`);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, shouldClearNativeTimers: true });
  vi.setSystemTime(new Date('2026-08-14T08:00:00.000Z'));
  window.history.replaceState({}, '', `/fleet?projectId=${PROJECT_ID}&workDate=${WORK_DATE}&asOf=${AS_OF}`);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TodayOperations', () => {
  it('shows truthful roll-call counts and every default actionable row', async () => {
    installFetch();
    render(<TodayOperations />);

    const counts = await screen.findByTestId('status-count-bar');
    expect(within(counts).getByRole('button', { name: 'On site 2' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(counts).getByRole('button', { name: 'Unverifiable 2' })).toBeInTheDocument();
    expect(screen.getByText('Vehicle Only Driver')).toBeInTheDocument();
    expect(within(screen.getByTestId('attention-row-vehicle_on_site_driver_unconfirmed'))
      .getByText(/Vehicle on site; driver presence unconfirmed/)).toBeInTheDocument();
    for (const name of attentionRows.map((item) => item.staffName)) expect(screen.getByText(name)).toBeInTheDocument();
    expect(counts).toHaveClass('grid-cols-2', 'sm:grid-cols-3', 'lg:grid-cols-6');
    expect(screen.getByTestId('attention-row-late')).toHaveClass('flex-col', 'sm:flex-row');
  });

  it('toggles a count filter, updates the URL, and restores defaults on second click', async () => {
    installFetch();
    render(<TodayOperations />);
    const late = await screen.findByRole('button', { name: 'Late 1' });

    fireEvent.click(late);
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('group')).toBe('late'));
    const selectedLate = await screen.findByRole('button', { name: 'Late 1' });
    expect(selectedLate).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.queryByText('Wrong Site Driver')).not.toBeInTheDocument());
    expect(screen.getByText('Late Driver')).toBeInTheDocument();

    fireEvent.click(selectedLate);
    await waitFor(() => expect(new URLSearchParams(window.location.search).has('group')).toBe(false));
    expect(await screen.findByText('Wrong Site Driver')).toBeInTheDocument();
  });

  it('defaults project/date safely and synchronizes selector changes to the URL', async () => {
    window.history.replaceState({}, '', '/fleet');
    installFetch();
    render(<TodayOperations />);

    await waitFor(() => expect(new URLSearchParams(window.location.search).get('projectId')).toBe(PROJECT_ID));
    expect(new URLSearchParams(window.location.search).get('workDate')).toBe('2026-08-14');
    const date = screen.getByLabelText('Operations date');
    fireEvent.change(date, { target: { value: WORK_DATE } });
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('workDate')).toBe(WORK_DATE));
    expect(await screen.findByText('Late Driver')).toBeInTheDocument();
  });

  it.each([
    ['no_scheduled_staff', 'No staff are scheduled for this selection.'],
    ['no_attention', 'No operational items need attention.'],
  ] as const)('distinguishes %s from other empty states', async (selectionState, message) => {
    installFetch({ overview: overview({
      selectionState,
      groups: [],
      attention: { items: [], page: 1, limit: 25, total: 0, hasMore: false },
      roster: { page: 1, limit: 100, total: selectionState === 'no_attention' ? 3 : 0, hasMore: false },
    }) });
    render(<TodayOperations />);
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('retains last data and timestamp with a stale warning after manual refresh fails', async () => {
    let overviewCalls = 0;
    installFetch();
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith('/api/fleet/assignments/options')) return Promise.resolve(ok({ staff: [], teams: [], projects: [{ id: PROJECT_ID, label: 'Lawley' }], sites: [], vehicles: [], siteSources: [] }));
      if (url.startsWith('/api/fleet/operations/overview')) {
        overviewCalls += 1;
        return Promise.resolve(overviewCalls === 1 ? ok(overview()) : fail(503, 'SERVICE_UNAVAILABLE', 'Database detail'));
      }
      return Promise.resolve(ok(detail));
    });
    render(<TodayOperations />);
    expect(await screen.findByText('Late Driver')).toBeInTheDocument();
    expect(screen.getByText(/Last evaluated/).querySelector('time')).toHaveAttribute('datetime', AS_OF);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh operations' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Showing the last successful operational data');
    expect(screen.getByText('Late Driver')).toBeInTheDocument();
    expect(overviewCalls).toBe(2);
  });

  it('hides the operational layer after a permission denial', async () => {
    installFetch({ overviewFailure: fail(403, 'FORBIDDEN', 'Sensitive project name') });
    render(<TodayOperations />);
    await waitFor(() => expect(vi.mocked(global.fetch).mock.calls.some(([url]) => String(url).includes('/overview'))).toBe(true));
    await waitFor(() => expect(screen.queryByRole('region', { name: "Today's Operations" })).not.toBeInTheDocument());
    expect(screen.queryByText('Sensitive project name')).not.toBeInTheDocument();
  });

  it('loads protected evidence, builds actions, traps focus, and restores the opener', async () => {
    installFetch();
    render(<TodayOperations />);
    const opener = await screen.findByRole('button', { name: 'View evidence for Late Driver' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole('dialog', { name: 'Evidence for Late Driver' });
    const close = within(dialog).getByRole('button', { name: 'Close evidence' });
    const map = within(dialog).getByRole('link', { name: 'View on map' });
    const manage = within(dialog).getByRole('link', { name: 'Manage assignment' });
    await waitFor(() => expect(within(dialog).getByText('arrival not confirmed')).toBeInTheDocument());
    expect(close).toHaveFocus();
    expect(map).toHaveAttribute('href', expect.stringContaining(`/fleet/map?projectId=${PROJECT_ID}`));
    expect(map).toHaveAttribute('href', expect.stringContaining(`staffId=${attentionRows[0]!.staffId}`));
    expect(manage).toHaveAttribute('href', expect.stringContaining(`/fleet/assignments?projectId=${PROJECT_ID}`));

    manage.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('does not disclose a protected detail error message', async () => {
    installFetch({ detailFailure: fail(403, 'FORBIDDEN', 'Secret scope detail') });
    render(<TodayOperations />);
    fireEvent.click(await screen.findByRole('button', { name: 'View evidence for Late Driver' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Evidence is unavailable for this selection.');
    expect(within(dialog).queryByText('Secret scope detail')).not.toBeInTheDocument();
  });
});

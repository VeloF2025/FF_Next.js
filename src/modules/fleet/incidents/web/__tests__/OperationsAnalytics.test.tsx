/** @vitest-environment jsdom */
/**
 * The Operations section on /fleet/analytics.
 *
 * Most of these are about what the screen must NOT let a reader conclude: that
 * a metric nobody reported is a zero, that a card covering one month of three
 * is a figure for the range, that a failed request is a quiet period, or that
 * any of this ranks a driver.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  report: vi.fn(), drillDown: vi.fn(), replace: vi.fn(), can: vi.fn(), permissionsLoading: { value: false },
}));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ can: mocks.can, isLoading: mocks.permissionsLoading.value }),
}));
vi.mock('next/router', () => ({ useRouter: () => ({ replace: mocks.replace, query: {}, pathname: '/fleet/analytics' }) }));
vi.mock('../operationsAnalyticsApi', async () => {
  const actual = await vi.importActual<typeof import('../operationsAnalyticsApi')>('../operationsAnalyticsApi');
  return { ...actual, operationsAnalyticsApi: { report: mocks.report, drillDown: mocks.drillDown } };
});

import { OperationsAnalytics } from '../OperationsAnalytics';
import { operationsExportUrl } from '../operationsAnalyticsApi';
import { IncidentApiError } from '../incidentApi';
import type { OperationsAnalyticsResponse, OperationsMetricValue } from '../../analytics/types';

function value(over: Partial<OperationsMetricValue> & { metricKey: string }): OperationsMetricValue {
  return {
    numerator: 0, denominator: null, histogram: null, coverage: { months: 3, of: 3 }, ...over,
  } as OperationsMetricValue;
}

function report(over: Partial<OperationsAnalyticsResponse> = {}): OperationsAnalyticsResponse {
  return {
    filters: { start: '2026-01-01', end: '2026-03-31' },
    metricVersion: 1,
    retainedDetailFrom: '2026-02-01',
    cards: [value({ metricKey: 'presence.confirmed_days', numerator: 90, denominator: 100 })],
    series: [{ monthStart: '2026-01-01', values: [value({ metricKey: 'presence.confirmed_days', numerator: 30, denominator: 33 })] }],
    suppressionNotices: [],
    freshness: { aggregatesThrough: '2026-07-01', lastRunStatus: 'succeeded' },
    ...over,
  } as OperationsAnalyticsResponse;
}

async function flush(): Promise<void> {
  await act(async () => { for (let tick = 0; tick < 5; tick += 1) await Promise.resolve(); });
}

async function renderSection(response: OperationsAnalyticsResponse = report()) {
  mocks.report.mockResolvedValue(response);
  render(<OperationsAnalytics />);
  await flush();
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.can.mockReturnValue(true);
  mocks.permissionsLoading.value = false;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(['xlsx']) });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:operations'), revokeObjectURL: vi.fn(),
  }));
  window.history.replaceState({}, '', '/fleet/analytics');
  mocks.report.mockResolvedValue(report());
  mocks.drillDown.mockResolvedValue({ mode: 'retained_detail', values: [], incidentIds: [], nextCursor: null });
});

describe('OperationsAnalytics', () => {
  it('says it is loading before the first answer arrives', async () => {
    mocks.report.mockReturnValue(new Promise(() => undefined));
    render(<OperationsAnalytics />);
    await flush();
    expect(screen.getByTestId('operations-loading')).toBeTruthy();
  });

  it('shows a headline card using the server percentage', async () => {
    await renderSection();
    const card = await screen.findByTestId('operations-card-presence.confirmed_days');
    expect(card.textContent).toContain('Confirmed present');
    expect(card.textContent).toContain('90%');
    expect(card.textContent).toContain('90');
    expect(card.textContent).toContain('100');
  });

  /**
   * A metric absent from the response is a metric the months in range did not
   * report — a component released at NONE contributes no row at all. Rendering
   * the card as 0% would turn "withheld or unmeasured" into "it never happened".
   */
  it('says a metric was not reported rather than drawing it as zero', async () => {
    await renderSection(report({ cards: [] }));
    const card = await screen.findByTestId('operations-card-presence.confirmed_days');
    expect(card.textContent).toMatch(/not reported/i);
    expect(card.textContent).not.toMatch(/\b0%/);
  });

  /**
   * Months do not all report the same keys, so a card can sum fewer months than
   * the range holds. Without this the figure reads as covering the whole range.
   */
  it('states when a figure covers fewer months than the range', async () => {
    await renderSection(report({
      cards: [value({ metricKey: 'presence.confirmed_days', numerator: 90, denominator: 100, coverage: { months: 1, of: 3 } })],
    }));
    const card = await screen.findByTestId('operations-card-presence.confirmed_days');
    expect(card.textContent).toMatch(/1 of 3/);
  });

  it('shows every suppression notice the server sent', async () => {
    const notices = ['No figures were published for the incident group in 2026-01-01.', 'Second notice.'];
    await renderSection(report({ suppressionNotices: notices }));
    for (const notice of notices) expect(await screen.findByText(notice)).toBeTruthy();
  });

  it('warns when the aggregates behind the historic half did not last succeed', async () => {
    await renderSection(report({ freshness: { aggregatesThrough: null, lastRunStatus: 'failed' } }));
    expect((await screen.findByTestId('operations-freshness')).textContent)
      .toMatch(/fail|incomplete|out of date/i);
  });

  it('states the retention boundary so a reader knows which months are which', async () => {
    await renderSection();
    expect(screen.getByTestId('operations-boundary').textContent).toContain('2026-02-01');
  });

  it('labels the breakdown rows rather than printing metric keys', async () => {
    await renderSection(report({
      cards: [value({ metricKey: 'incident.accident_sos', numerator: 2 })],
    }));
    const table = await screen.findByTestId('operations-breakdown');
    expect(table.textContent).toContain('Accident / SOS');
    expect(table.textContent).not.toContain('incident.accident_sos');
  });

  /**
   * A failed request must not render as a report of zeros — the one reading a
   * spreadsheet-shaped screen has no way to tell the two apart.
   */
  it('clears the figures when a refetch fails, rather than leaving the old ones reading as the answer', async () => {
    await renderSection();
    expect(screen.getByTestId('operations-card-presence.confirmed_days').textContent).toContain('90%');

    mocks.report.mockRejectedValue(new IncidentApiError('connection reset', 500, 'INTERNAL'));
    fireEvent.change(screen.getByTestId('operations-filter-severity'), { target: { value: 'critical' } });
    await flush();

    expect(await screen.findByTestId('operations-error')).toBeTruthy();
    expect(screen.queryByTestId('operations-card-presence.confirmed_days')).toBeNull();
  });

  it('passes the server explanation through when a filter cannot span the boundary', async () => {
    mocks.report.mockRejectedValue(new IncidentApiError(
      'op_driver and op_vehicle only apply to months at or after 2025-08-01', 400, 'BAD_REQUEST',
    ));
    render(<OperationsAnalytics />);
    await flush();
    expect((await screen.findByTestId('operations-error')).textContent).toContain('2025-08-01');
  });

  /**
   * The parity claim, stated against what was actually asked rather than
   * against a hardcoded range: the file a manager downloads must carry the same
   * question as the screen they downloaded it from.
   */
  it('asks the export for exactly what the screen asked for', async () => {
    await renderSection();
    const asked = mocks.report.mock.calls.at(-1)?.[0] as OperationsAnalyticsResponse['filters'];
    const button = screen.getByTestId('operations-export');
    expect(button.getAttribute('data-export-url')).toBe(operationsExportUrl(asked));

    await act(async () => { button.click(); });
    await flush();
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe(operationsExportUrl(asked));
  });

  /**
   * It was a link, and a link to a refused export navigates the reader off the
   * screen and onto the raw `{"success":false,…}` envelope. The refusal has to
   * land in the error box, in the server's own words.
   */
  it('renders a refused export in the error box instead of navigating to raw JSON', async () => {
    await renderSection();
    fetchMock.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ success: false, error: { code: 'BAD_REQUEST', message: 'op_sevrity is not a filter this endpoint accepts' } }),
    });
    await act(async () => { screen.getByTestId('operations-export').click(); });
    await flush();
    expect((await screen.findByTestId('operations-error')).textContent)
      .toContain('op_sevrity is not a filter this endpoint accepts');
  });

  it('re-asks and re-links when a filter changes', async () => {
    await renderSection();
    const before = mocks.report.mock.calls.length;
    fireEvent.change(screen.getByTestId('operations-filter-severity'), { target: { value: 'critical' } });
    await flush();
    await waitFor(() => expect(mocks.report.mock.calls.length).toBeGreaterThan(before));
    expect(mocks.report.mock.calls.at(-1)?.[0]).toMatchObject({ severity: 'critical' });
    expect(screen.getByTestId('operations-export').getAttribute('data-export-url'))
      .toContain('op_severity=critical');
  });

  /**
   * The filters are pushed to the URL under their own `op_` names. The vehicle
   * scorecard's controls are component state and never reach the URL, so this
   * is also what keeps a deep link into one from disturbing the other.
   */
  it('puts its own filters on the URL under op_ names only', async () => {
    await renderSection();
    fireEvent.change(screen.getByTestId('operations-filter-severity'), { target: { value: 'critical' } });
    await flush();
    const written = mocks.replace.mock.calls.at(-1)?.[0] as string | undefined;
    expect(written).toContain('op_severity=critical');
    expect(written).not.toMatch(/[?&]severity=/);
    expect(written).not.toMatch(/[?&]projectId=/);
  });

  /**
   * PR8's standing constraint. No leaderboard, no driver score, no ranking, no
   * disciplinary rating — not as a feature and not as a turn of phrase that
   * would invite one.
   */
  /**
   * An `op_` key this client does not shape — a typo, or a filter added to the
   * endpoint before the picker — must reach the server, because the server is
   * what says "op_sevrity is not a filter this endpoint accepts". Dropping it
   * substitutes a silently WIDER report for that sentence.
   */
  it('passes an unshaped op_ key through to the API', async () => {
    window.history.replaceState({}, '', '/fleet/analytics?op_sevrity=high');
    await renderSection();
    expect(mocks.report.mock.calls.at(-1)?.[2]).toEqual({ op_sevrity: 'high' });
  });

  it('keeps an unshaped op_ key on the URL rather than erasing it', async () => {
    window.history.replaceState({}, '', '/fleet/analytics?op_sevrity=high');
    await renderSection();
    expect(mocks.replace.mock.calls.at(-1)?.[0] as string).toContain('op_sevrity=high');
  });

  it('renders the server refusal an unshaped key earned', async () => {
    window.history.replaceState({}, '', '/fleet/analytics?op_sevrity=high');
    mocks.report.mockRejectedValue(new IncidentApiError(
      'op_sevrity is not a filter this endpoint accepts; the ones it does are: op_start, op_end', 400, 'BAD_REQUEST',
    ));
    render(<OperationsAnalytics />);
    await flush();
    expect((await screen.findByTestId('operations-error')).textContent).toContain('op_sevrity is not a filter');
  });

  /** Gated on the same permission the endpoints behind it are gated on. */
  it('renders nothing at all without fleet.incidents view', async () => {
    mocks.can.mockReturnValue(false);
    render(<OperationsAnalytics />);
    await flush();
    expect(screen.queryByTestId('operations-analytics')).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/cannot view|403|forbidden/i);
  });

  it('renders nothing while the permissions are still loading', async () => {
    mocks.permissionsLoading.value = true;
    render(<OperationsAnalytics />);
    await flush();
    expect(screen.queryByTestId('operations-analytics')).toBeNull();
  });

  /**
   * A timing metric's numerator is a structural zero — the calculator observes
   * a duration for it and never bumps a tally — so printing it in the count
   * column reports "0 acknowledgements" for a month that had several.
   */
  it('leaves a timing metric out of the count column rather than printing its zero', async () => {
    await renderSection(report({
      cards: [value({ metricKey: 'timing.acknowledgement', numerator: 0, histogram: { sampleCount: 12, buckets: [] } })],
    }));
    const row = (await screen.findByTestId('operations-breakdown')).querySelector('tbody tr');
    const cells = [...(row?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent);
    expect(cells[0]).toContain('Time to acknowledge');
    expect(cells[1]).toBe('');
    expect(cells[4]).toContain('12 samples');
  });

  /** An empty answer is not a count of zero, and must not read as one. */
  it('says an empty answer is not a zero', async () => {
    await renderSection(report({ cards: [] }));
    const empty = await screen.findByTestId('operations-empty');
    expect(empty.textContent).toMatch(/not a count of zero/i);
  });

  /**
   * The drawer answers ONE filter set. Left open across a filter change it
   * shows the incidents behind the previous question under the new one.
   */
  it('closes the drill-down when a filter changes', async () => {
    await renderSection();
    await act(async () => { screen.getByTestId('operations-drilldown-open').click(); });
    await flush();
    expect(screen.getByTestId('operations-drilldown')).toBeTruthy();

    fireEvent.change(screen.getByTestId('operations-filter-severity'), { target: { value: 'critical' } });
    await flush();
    expect(screen.queryByTestId('operations-drilldown')).toBeNull();
  });

  it('ranks and scores nobody', async () => {
    await renderSection(report({
      cards: [
        value({ metricKey: 'presence.confirmed_days', numerator: 90, denominator: 100 }),
        value({ metricKey: 'incident.late', numerator: 4 }),
      ],
    }));
    expect(document.body.textContent ?? '')
      .not.toMatch(/leaderboard|ranking|ranked|driver score|rating|best|worst|top performer|offender/i);
  });
});

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

const mocks = vi.hoisted(() => ({ report: vi.fn(), drillDown: vi.fn(), replace: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
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

beforeEach(() => {
  vi.clearAllMocks();
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
  it('links the export to exactly what the screen asked for', async () => {
    await renderSection();
    const asked = mocks.report.mock.calls.at(-1)?.[0] as OperationsAnalyticsResponse['filters'];
    const link = screen.getByTestId('operations-export') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(operationsExportUrl(asked));
    expect(link.getAttribute('href')).toContain('/api/fleet/analytics/operations/export?');
  });

  it('re-asks and re-links when a filter changes', async () => {
    await renderSection();
    const before = mocks.report.mock.calls.length;
    fireEvent.change(screen.getByTestId('operations-filter-severity'), { target: { value: 'critical' } });
    await flush();
    await waitFor(() => expect(mocks.report.mock.calls.length).toBeGreaterThan(before));
    expect(mocks.report.mock.calls.at(-1)?.[0]).toMatchObject({ severity: 'critical' });
    expect((screen.getByTestId('operations-export') as HTMLAnchorElement).getAttribute('href'))
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

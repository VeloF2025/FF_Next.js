/** @vitest-environment jsdom */
/**
 * The drill-down drawer.
 *
 * `aggregate_only` is the case worth the test file. It is not an error and not
 * an empty result: the months asked about no longer hold identifiable detail,
 * and an empty list rendered without saying so reads as "no incidents".
 */
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ drillDown: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../operationsAnalyticsApi', async () => {
  const actual = await vi.importActual<typeof import('../operationsAnalyticsApi')>('../operationsAnalyticsApi');
  return { ...actual, operationsAnalyticsApi: { report: vi.fn(), drillDown: mocks.drillDown } };
});

import { OperationsHistoryDrawer } from '../OperationsHistoryDrawer';
import { IncidentApiError } from '../incidentApi';
import type { OperationsFilters } from '../../analytics/types';

const FILTERS: OperationsFilters = { start: '2026-01-01', end: '2026-03-31' };
const INCIDENT = '55555555-5555-4555-8555-555555555555';

async function flush(): Promise<void> {
  await act(async () => { for (let tick = 0; tick < 5; tick += 1) await Promise.resolve(); });
}

async function open(): Promise<void> {
  render(<OperationsHistoryDrawer filters={FILTERS} onClose={() => undefined} />);
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.drillDown.mockResolvedValue({
    mode: 'retained_detail', values: [], incidentIds: [INCIDENT], nextCursor: null,
  });
});

describe('OperationsHistoryDrawer', () => {
  it('links each retained incident to the queue that governs it', async () => {
    await open();
    const link = await screen.findByTestId(`operations-incident-${INCIDENT}`);
    expect(link.getAttribute('href')).toContain(INCIDENT);
  });

  it('explains an aggregate-only period instead of showing an empty list', async () => {
    mocks.drillDown.mockResolvedValue({
      mode: 'aggregate_only',
      values: [{ metricKey: 'incident.late', numerator: 9, denominator: null, histogram: null, coverage: { months: 1, of: 1 } }],
      incidentIds: [], nextCursor: null,
    });
    await open();
    const panel = await screen.findByTestId('operations-drilldown');
    expect(panel.textContent).toMatch(/no longer|not retained|removed|expired/i);
    expect(panel.textContent).not.toMatch(/no incidents|nothing happened/i);
    // The figures still stand — the detail behind them is what is gone.
    expect(panel.textContent).toContain('9');
  });

  it('does not dress an aggregate-only answer as a failure', async () => {
    mocks.drillDown.mockResolvedValue({
      mode: 'aggregate_only', values: [], incidentIds: [], nextCursor: null,
    });
    await open();
    expect(screen.queryByTestId('operations-drilldown-error')).toBeNull();
  });

  /**
   * A drill-down answers in incident ids and the purged months have none, so a
   * range straddling the boundary is refused server-side. The reader needs the
   * reason, not a generic failure.
   */
  it('shows the server reason when the range straddles the retention boundary', async () => {
    mocks.drillDown.mockRejectedValue(new IncidentApiError(
      'a drill-down covers one side of the retention boundary at a time, and 2026-02-01 splits this range',
      400, 'BAD_REQUEST',
    ));
    await open();
    expect((await screen.findByTestId('operations-drilldown-error')).textContent).toContain('2026-02-01');
  });

  it('asks for the next page with the cursor the server gave it', async () => {
    mocks.drillDown.mockResolvedValueOnce({
      mode: 'retained_detail', values: [], incidentIds: [INCIDENT], nextCursor: INCIDENT,
    });
    await open();
    const more = await screen.findByTestId('operations-drilldown-more');
    await act(async () => { more.click(); });
    await flush();
    expect(mocks.drillDown).toHaveBeenLastCalledWith(FILTERS, INCIDENT, expect.anything(), undefined);
  });

  it('offers no next page when the server gave no cursor', async () => {
    await open();
    expect(screen.queryByTestId('operations-drilldown-more')).toBeNull();
  });

  /**
   * The cursor IS an incident id and the server pages inclusively of it, so the
   * last row of one page arrives again as the first row of the next. Appending
   * blind renders two <li> under one key — React warns, and a reader counting
   * down the list to explain a figure counts one incident twice.
   */
  it('does not repeat an incident that arrives on two pages', async () => {
    const second = '66666666-6666-4666-8666-666666666666';
    mocks.drillDown.mockResolvedValueOnce({
      mode: 'retained_detail', values: [], incidentIds: [INCIDENT], nextCursor: INCIDENT,
    });
    mocks.drillDown.mockResolvedValueOnce({
      mode: 'retained_detail', values: [], incidentIds: [INCIDENT, second], nextCursor: null,
    });
    await open();
    await act(async () => { (await screen.findByTestId('operations-drilldown-more')).click(); });
    await flush();
    expect(screen.getAllByTestId(`operations-incident-${INCIDENT}`)).toHaveLength(1);
    expect(screen.getByTestId(`operations-incident-${second}`)).toBeTruthy();
  });

  /**
   * An unshaped `op_` key must reach the drill-down too, or a filter the report
   * was refused over would be quietly honoured here.
   */
  it('carries unshaped op_ keys through to the drill-down request', async () => {
    render(<OperationsHistoryDrawer filters={FILTERS} extras={{ op_sevrity: 'high' }} onClose={() => undefined} />);
    await flush();
    expect(mocks.drillDown).toHaveBeenLastCalledWith(
      FILTERS, null, expect.anything(), { op_sevrity: 'high' },
    );
  });
});

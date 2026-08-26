/**
 * One serializer, three consumers: the analytics fetch, the drill-down fetch,
 * and the export link. The tests that matter here are the parity ones — the
 * file a manager downloads has to have been asked the same question as the
 * screen they downloaded it from.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchOperationsExport, operationsAnalyticsApi, operationsExportUrl, operationsQueryString,
  parseOperationsUrlExtras, parseOperationsUrlFilters,
} from '../operationsAnalyticsApi';
import { IncidentApiError } from '../incidentApi';
import type { OperationsFilters } from '../../analytics/types';

const PROJECT = '33333333-3333-4333-8333-333333333333';
const DRIVER = '44444444-4444-4444-8444-444444444444';
const FALLBACK = { start: '2026-01-01', end: '2026-03-31' };

const full: OperationsFilters = {
  start: '2026-01-01', end: '2026-03-31', projectId: PROJECT, staffId: DRIVER,
  incidentType: 'late', severity: 'high', outcome: 'confirmed', evidenceAvailable: false,
};

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) });
  vi.stubGlobal('fetch', fetchMock);
});

/** The query string of the last URL fetch was called with. */
function lastQuery(): string {
  const url = String(fetchMock.mock.calls.at(-1)?.[0] ?? '');
  return url.slice(url.indexOf('?'));
}

describe('operationsQueryString', () => {
  it('names every filter with its op_ prefix', () => {
    const params = new URLSearchParams(operationsQueryString(full));
    expect(params.get('op_start')).toBe('2026-01-01');
    expect(params.get('op_end')).toBe('2026-03-31');
    expect(params.get('op_project')).toBe(PROJECT);
    expect(params.get('op_driver')).toBe(DRIVER);
    expect(params.get('op_type')).toBe('late');
    expect(params.get('op_severity')).toBe('high');
    expect(params.get('op_outcome')).toBe('confirmed');
    expect(params.get('op_evidence')).toBe('false');
  });

  /**
   * The queue puts `projectId` and `staffId` on the query string of its own
   * screen. Sharing bare names would make a deep link from one silently
   * pre-filter the other.
   */
  it('never emits a bare filter name', () => {
    for (const key of new URLSearchParams(operationsQueryString(full)).keys()) {
      expect(key.startsWith('op_')).toBe(true);
    }
  });

  it('omits an unset filter rather than sending it empty', () => {
    const params = new URLSearchParams(operationsQueryString({ start: '2026-01-01', end: '2026-03-31' }));
    expect([...params.keys()]).toEqual(['op_start', 'op_end']);
  });

  it('round-trips through the URL unchanged', () => {
    expect(parseOperationsUrlFilters(operationsQueryString(full), FALLBACK)).toEqual(full);
  });
});

describe('parseOperationsUrlFilters', () => {
  it('falls back to the default range when the URL carries none', () => {
    expect(parseOperationsUrlFilters('?other=1', FALLBACK)).toEqual(FALLBACK);
  });

  /**
   * The page's own vehicle scorecard filters are component state and are not on
   * the query string at all. A parser that read anything outside `op_` would be
   * the first thing to couple them.
   */
  it('ignores every parameter outside the op_ namespace', () => {
    const parsed = parseOperationsUrlFilters(`?projectId=${PROJECT}&period=3m&staffId=${DRIVER}`, FALLBACK);
    expect(parsed).toEqual(FALLBACK);
  });

  it('drops an empty value rather than sending it to the server', () => {
    expect(parseOperationsUrlFilters('?op_project=&op_type=', FALLBACK)).toEqual(FALLBACK);
  });
});

describe('filter parity', () => {
  /**
   * The one that matters. An export built from a second serialization is an
   * export that eventually disagrees with the screen, and the reader holding
   * the file cannot tell which of the two is wrong.
   */
  it('asks the export for exactly what the screen was asked', async () => {
    await operationsAnalyticsApi.report(full);
    expect(operationsExportUrl(full)).toContain(lastQuery());
  });

  it('sends the drill-down the same filters as the report', async () => {
    await operationsAnalyticsApi.report(full);
    const reportQuery = lastQuery();
    await operationsAnalyticsApi.drillDown(full, null);
    expect(lastQuery()).toBe(reportQuery);
  });

  it('appends the drill-down cursor without disturbing the filters', async () => {
    await operationsAnalyticsApi.drillDown(full, 'abc');
    const params = new URLSearchParams(lastQuery());
    expect(params.get('cursor')).toBe('abc');
    expect(params.get('op_project')).toBe(PROJECT);
  });

  it('points the three at their own endpoints', async () => {
    await operationsAnalyticsApi.report(full);
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('/api/fleet/analytics/operations?');
    await operationsAnalyticsApi.drillDown(full, null);
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('/api/fleet/analytics/operations/drill-down?');
    expect(operationsExportUrl(full)).toContain('/api/fleet/analytics/operations/export?');
  });
});

/**
 * The server refuses an `op_` key it does not know, by name, in a sentence. It
 * can only do that if the key reaches it — a client that whitelisted `op_` keys
 * of its own would answer `op_sevrity=high` with an unfiltered report and never
 * mention the filter it discarded.
 */
describe('unshaped op_ parameters', () => {
  it('collects an op_ key this client does not shape', () => {
    expect(parseOperationsUrlExtras('?op_start=2026-01-01&op_sevrity=high&period=3m'))
      .toEqual({ op_sevrity: 'high' });
  });

  it('collects nothing outside the op_ namespace', () => {
    expect(parseOperationsUrlExtras('?projectId=x&period=3m&severity=high')).toEqual({});
  });

  it('treats no shaped filter name as an extra', () => {
    const extras = parseOperationsUrlExtras(operationsQueryString(full));
    expect(extras).toEqual({});
  });

  it('sends an unshaped key to the server rather than dropping it', () => {
    const query = new URLSearchParams(operationsQueryString(full, { op_sevrity: 'high' }));
    expect(query.get('op_sevrity')).toBe('high');
    expect(query.get('op_severity')).toBe('high');
  });

  it('carries unshaped keys onto the export URL too', () => {
    expect(operationsExportUrl(full, { op_sevrity: 'high' })).toContain('op_sevrity=high');
  });

  it('never lets an extra overwrite a shaped filter', () => {
    const query = new URLSearchParams(operationsQueryString(full, { op_severity: 'low' }));
    expect(query.getAll('op_severity')).toEqual(['high']);
  });
});

describe('fetchOperationsExport', () => {
  it('returns the bytes when the server produced them', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(['xlsx']) });
    await expect(fetchOperationsExport(full)).resolves.toBeInstanceOf(Blob);
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe(operationsExportUrl(full));
  });

  /**
   * The reason this is a fetch and not a link. A link to a refused export
   * navigates the reader onto the raw envelope; this keeps the server's own
   * sentence available to the screen.
   */
  it('raises the server sentence verbatim when the export is refused', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ success: false, error: { code: 'BAD_REQUEST', message: 'op_sevrity is not a filter this endpoint accepts' } }),
    });
    await expect(fetchOperationsExport(full)).rejects.toThrow('op_sevrity is not a filter this endpoint accepts');
  });

  it('still fails loudly when the refusal is not an envelope', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('not json'); } });
    await expect(fetchOperationsExport(full)).rejects.toBeInstanceOf(IncidentApiError);
  });
});

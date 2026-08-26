/**
 * The trend chart's data mapping.
 *
 * Recharts measures its container to decide what to draw and a jsdom container
 * measures zero, so a rendering assertion here would pass against an empty SVG
 * whatever the mapping did. These are therefore asserted against the points, in
 * the pure function the chart plots.
 */
import { describe, expect, it } from 'vitest';
import { buildChartPoints, reportedKeys } from '../operationsChartData';
import type { OperationsAnalyticsResponse } from '../../analytics/types';

function month(monthStart: string, values: { metricKey: string; numerator: number }[]) {
  return {
    monthStart,
    values: values.map((value) => ({
      ...value, denominator: null, histogram: null, coverage: { months: 1, of: 1 },
    })),
  };
}

const REPORT = {
  filters: { start: '2026-01-01', end: '2026-03-31' },
  metricVersion: 1,
  retainedDetailFrom: '2026-02-01',
  cards: [],
  series: [
    month('2026-01-01', [{ metricKey: 'presence.confirmed_days', numerator: 11 }]),
    month('2026-02-01', [{ metricKey: 'presence.confirmed_days', numerator: 22 }]),
    // Reported nothing for the key at all.
    month('2026-03-01', [{ metricKey: 'incident.late', numerator: 3 }]),
  ],
  suppressionNotices: [],
  freshness: { aggregatesThrough: '2026-03-01', lastRunStatus: 'succeeded' },
} as unknown as OperationsAnalyticsResponse;

describe('buildChartPoints', () => {
  /**
   * A retained month is derived live from the detail behind it; an earlier one
   * is whatever the anonymous aggregate published, which may be less. A reader
   * comparing two short bars is entitled to know one of them can be short
   * because the figure was withheld.
   */
  it('flags each month by which side of the retention boundary it came from', () => {
    const points = buildChartPoints(REPORT, 'presence.confirmed_days');
    expect(points.map((point) => [point.month, point.retained])).toEqual([
      ['2026-01', false], ['2026-02', true], ['2026-03', true],
    ]);
  });

  it('marks the boundary month itself as retained', () => {
    const boundary = buildChartPoints(REPORT, 'presence.confirmed_days')
      .find((point) => point.month === '2026-02');
    expect(boundary?.retained).toBe(true);
  });

  /**
   * A month that published nothing for the key is a gap. Plotted as zero it
   * becomes a month in which the thing measurably did not happen.
   */
  it('plots a month that reported nothing as a gap rather than a zero', () => {
    const points = buildChartPoints(REPORT, 'presence.confirmed_days');
    expect(points.map((point) => point.value)).toEqual([11, 22, null]);
    expect(points.some((point) => point.value === 0)).toBe(false);
  });

  /** And a real zero is still a zero — the gap must not swallow a reported one. */
  it('keeps a reported zero as a zero', () => {
    const withZero = {
      ...REPORT,
      series: [month('2026-01-01', [{ metricKey: 'presence.confirmed_days', numerator: 0 }])],
    } as unknown as OperationsAnalyticsResponse;
    expect(buildChartPoints(withZero, 'presence.confirmed_days')[0]?.value).toBe(0);
  });
});

describe('reportedKeys', () => {
  it('offers only keys some month actually reported', () => {
    expect(reportedKeys(REPORT)).toEqual(['presence.confirmed_days', 'incident.late']);
  });
});

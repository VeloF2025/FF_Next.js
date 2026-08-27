/**
 * The trend chart's data, apart from the chart (stage 8, task 9).
 *
 * A separate module because Recharts measures its container to decide what to
 * draw and a jsdom container measures zero: a rendering test asserts on an
 * empty SVG and passes whatever the mapping did. The two claims the chart makes
 * about honesty — a month that reported nothing is a GAP and not a zero, and
 * every month is flagged by which side of the retention boundary it came from —
 * are therefore made here, where a test can hold them against the data.
 */
import { METRIC_GROUPS } from './operationsMetricLabels';
import type { OperationsMetricKey } from '../analytics/aggregateSchema';
import type { OperationsAnalyticsResponse } from '../analytics/types';

/** Every key any month reported, so the picker never offers an empty chart. */
export function reportedKeys(report: OperationsAnalyticsResponse): OperationsMetricKey[] {
  const seen = new Set<OperationsMetricKey>();
  for (const month of report.series) for (const value of month.values) seen.add(value.metricKey);
  return METRIC_GROUPS.flatMap((group) => group.keys).filter((key) => seen.has(key));
}

export interface ChartPoint {
  month: string;
  /** `null` where the month did not report the key — a gap, never a zero. */
  value: number | null;
  /** True where the month is derived from retained detail rather than a published aggregate. */
  retained: boolean;
}

/** The plotted points for one metric, one entry per month in the response. */
export function buildChartPoints(
  report: OperationsAnalyticsResponse, selected: OperationsMetricKey,
): ChartPoint[] {
  return report.series.map((month) => {
    const value = month.values.find((candidate) => candidate.metricKey === selected);
    return {
      month: month.monthStart.slice(0, 7),
      value: value === undefined ? null : value.numerator,
      retained: month.monthStart >= report.retainedDetailFrom,
    };
  });
}

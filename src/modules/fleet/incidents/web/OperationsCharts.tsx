/**
 * The monthly trend (stage 8, task 9).
 *
 * One metric at a time, chosen by the reader. Plotting several at once would
 * invite comparing a presence count against an incident count, and the two
 * divide by different populations.
 *
 * Each bar is coloured by where the month came from. That is not decoration:
 * a retained month is derived live from the detail behind it, while an earlier
 * month is whatever the anonymous aggregate published — which may be less. A
 * reader comparing a short bar in March against a short bar in October is
 * entitled to know that one of them can be short because the figure was
 * withheld.
 */
import { useState } from 'react';
import { Bar, BarChart, Cell, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { OperationsMetricKey } from '../analytics/aggregateSchema';
import type { OperationsAnalyticsResponse } from '../analytics/types';
import { metricLabel } from './operationsMetricLabels';
import { buildChartPoints, reportedKeys } from './operationsChartData';

const RETAINED_COLOUR = '#8B5CF6';
const PUBLISHED_COLOUR = '#06B6D4';

export interface OperationsChartsProps {
  report: OperationsAnalyticsResponse;
}

export function OperationsCharts({ report }: OperationsChartsProps) {
  const keys = reportedKeys(report);
  const [metricKey, setMetricKey] = useState<OperationsMetricKey | null>(null);
  const selected = metricKey !== null && keys.includes(metricKey) ? metricKey : keys[0];
  if (selected === undefined) return null;

  const data = buildChartPoints(report, selected);

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <label htmlFor="operations-chart-metric" className="text-xs text-[var(--ff-text-secondary)]">
          Monthly trend
        </label>
        <select
          id="operations-chart-metric" data-testid="operations-chart-metric" value={selected}
          onChange={(event) => setMetricKey(event.target.value as OperationsMetricKey)}
          className="px-3 py-1.5 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm"
        >
          {keys.map((key) => <option key={key} value={key}>{metricLabel(key)}</option>)}
        </select>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--ff-border-light)" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="value" name={metricLabel(selected)}>
            {data.map((point) => (
              <Cell key={point.month} fill={point.retained ? RETAINED_COLOUR : PUBLISHED_COLOUR} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <p className="text-[10px] text-[var(--ff-text-tertiary)] mt-2">
        <span style={{ color: RETAINED_COLOUR }}>■</span> derived from retained detail
        {'  '}
        <span style={{ color: PUBLISHED_COLOUR }}>■</span> from published anonymous aggregates,
        which may withhold figures describing too few people
      </p>
    </div>
  );
}

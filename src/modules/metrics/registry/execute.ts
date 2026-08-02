import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { buildMetricQuery, type MetricQuery } from './queryBuilder';
import { toSeries, summarise, type MetricSeriesPoint } from './series';
import type { MetricDefinition } from './types';

// Re-exported so consumers have one import site for the metric contract, while
// the pure logic itself stays in a module that does not require a database.
export { toSeries, summarise, type MetricSeriesPoint };

export interface MetricResponse {
  key: string;
  label: string;
  grain: string;
  /** How `total` was derived: 'additive' sums the series; anything else takes the latest period. */
  additivity: 'additive' | 'semi-additive' | 'non-additive';
  /** For a non-additive/semi-additive metric, the period `total` is "as at". Null otherwise. */
  total_period: string | null;
  as_of: string;
  total: number;
  series: MetricSeriesPoint[];
  citation: {
    source: 'fibreflow';
    source_id: string;
    channel: string;
    timestamp: string;
    snippet: string;
  };
}

/** Execute a metric. Throws on failure — callers must not silently degrade to prose. */
export async function executeMetric(
  def: MetricDefinition,
  query: MetricQuery,
): Promise<MetricResponse> {
  const { sql, params } = buildMetricQuery(def, query);
  const asOf = new Date().toISOString();

  const client = await pool.connect();
  let rows: Record<string, unknown>[];
  try {
    // SET LOCAL requires a transaction block. Outside one it emits
    // "SET LOCAL can only be used in transaction blocks" and is DISCARDED — the
    // query would then run with no timeout at all against the shared production DB.
    // Plain SET would work but leaks the setting to the next borrower of this
    // pooled connection. BEGIN + SET LOCAL + COMMIT is the only correct form.
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '8s'");
    // Pin the session timezone. `date_trunc` and the date-range comparison on a
    // TIMESTAMPTZ column both resolve against it, so leaving it at the server
    // default silently shifts every day/week boundary — a row captured at 01:00
    // SAST would land in the previous day. The business day is SAST, so the
    // metric layer must say so rather than inherit whatever the connection had.
    await client.query("SET LOCAL TIME ZONE 'Africa/Johannesburg'");
    const result = await client.query(sql, params);
    rows = result.rows;
    await client.query('COMMIT');
  } catch (error) {
    // Must roll back before release, or the connection returns to the pool
    // inside a failed transaction and poisons the next caller.
    await client
      .query('ROLLBACK')
      .catch((rollbackError) => log.error('Metric rollback failed', { key: def.key, rollbackError }));
    log.error('Metric execution failed', { key: def.key, error });
    throw error;
  } finally {
    client.release();
  }

  const series = toSeries(rows, query.dimensions);
  const { total, totalPeriod } = summarise(def, series);

  const periodLabel = query.from === query.to ? query.from : `${query.from}..${query.to}`;

  return {
    key: def.key,
    label: def.label,
    grain: query.grain,
    additivity: def.additivity,
    total_period: totalPeriod,
    as_of: asOf,
    total,
    series,
    citation: {
      source: 'fibreflow',
      source_id: `metric:${def.key}:${periodLabel}`,
      channel: def.cite,
      timestamp: asOf,
      snippet: `${def.cite} - ${total} ${def.label} (${periodLabel})`,
    },
  };
}

/**
 * Pure shaping and summarisation of metric result rows.
 *
 * Deliberately free of any database import. `execute.ts` builds a pool at module
 * scope (via the Neon shim in `lib/db.mjs`, which throws at import when
 * DATABASE_URL is unset), so anything importing from there drags a live
 * connection requirement along with it. Keeping these two functions here lets
 * both the unit tests and the real-Postgres test exercise the ACTUAL production
 * logic rather than a second copy written inside a test.
 */
import type { MetricDefinition } from './types';

export interface MetricSeriesPoint {
  period: string | null;
  dimensions: Record<string, string | null>;
  value: number;
}

/** Shape raw result rows into the response series. */
export function toSeries(
  rows: Record<string, unknown>[],
  dimensions: readonly string[],
): MetricSeriesPoint[] {
  return rows.map((r) => {
    const dims: Record<string, string | null> = {};
    for (const d of dimensions) {
      const raw = r[d];
      // String(), so the runtime value matches the declared `string | null`.
      // Every DIMENSIONS expression already casts to text; this is the guard for
      // the next one that forgets. NOTE: a future DATE-typed dimension must cast
      // in SQL regardless — String() on a pg Date yields "Mon Jul 21", not ISO.
      dims[d] = raw === null || raw === undefined ? null : String(raw);
    }
    return {
      // Already 'YYYY-MM-DD' text from to_char — no Date marshalling, no slicing.
      period: (r.period as string | null) ?? null,
      dimensions: dims,
      value: Number(r.value ?? 0),
    };
  });
}

/**
 * Reduce a series to a single headline number, according to the metric's additivity.
 *
 * A cumulative series is a sequence of running totals; summing it is meaningless.
 * For anything not 'additive', `total` is the sum across dimensions WITHIN the
 * latest period present, and `totalPeriod` names that period so the consumer is
 * never guessing.
 *
 * Documented limitation: if one dimension value stops reporting earlier than
 * another, it is absent from the latest period and so excluded from `total`. That
 * is the correct reading of "as at the latest period" and is why `total_period` is
 * returned — a caller comparing totals across requests can see the as-at date
 * shift. Do not silently carry values forward.
 */
export function summarise(
  def: MetricDefinition,
  series: MetricSeriesPoint[],
): { total: number; totalPeriod: string | null } {
  if (def.additivity === 'additive') {
    return { total: series.reduce((sum, p) => sum + p.value, 0), totalPeriod: null };
  }
  const periods = series.map((p) => p.period).filter((p): p is string => p !== null);
  // Lexical max is correct because to_char guarantees zero-padded ISO.
  const totalPeriod = periods.length ? periods.reduce((a, b) => (a > b ? a : b)) : null;
  const total = series
    .filter((p) => p.period === totalPeriod)
    .reduce((sum, p) => sum + p.value, 0);
  return { total, totalPeriod };
}

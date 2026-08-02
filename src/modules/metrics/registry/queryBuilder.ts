import { DIMENSIONS, type DimensionSpec } from '../dimensions/canonical';
import type { Grain, MetricDefinition } from './types';

export interface MetricQuery {
  from: string; // ISO date, inclusive
  to: string; // ISO date, inclusive
  grain: Grain;
  dimensions: readonly string[];
}

const GRAIN_TRUNC: Record<Exclude<Grain, 'range'>, string> = {
  day: 'day',
  week: 'week',
  month: 'month',
};

/**
 * Check a request against the definition and resolve its dimension specs.
 *
 * Separate from buildMetricQuery so the HTTP layer can reject a bad grain or
 * dimension — a 400 — before spending a database round-trip on the RBAC check,
 * while the rules themselves live in exactly one place. buildMetricQuery calls
 * it too, so executeMetric is still safe for any other caller.
 *
 * Throws on the first problem. Messages start with 'unsupported grain' /
 * 'unsupported dimension'; the API matches on that to map them to 400.
 */
export function validateMetricQuery(
  def: MetricDefinition,
  query: MetricQuery,
): DimensionSpec[] {
  if (!def.grains.includes(query.grain)) {
    throw new Error(
      `unsupported grain '${query.grain}' for metric '${def.key}' (supports: ${def.grains.join(', ')})`,
    );
  }

  // A cumulative or stock measure collapsed to a single bucket would sum several
  // running totals into a meaningless number. Refuse rather than return it.
  if (def.additivity !== 'additive' && query.grain === 'range') {
    throw new Error(
      `unsupported grain 'range' for ${def.additivity} metric '${def.key}' — ` +
        `collapsing the period would sum values that are not summable over time. ` +
        `Request a periodic grain and read the final period.`,
    );
  }

  return query.dimensions.map((name) => {
    if (!def.dimensions.includes(name)) {
      throw new Error(
        `unsupported dimension '${name}' for metric '${def.key}' ` +
          `(supports: ${def.dimensions.join(', ') || 'none'})`,
      );
    }
    const spec = DIMENSIONS.find((d) => d.key === name);
    if (!spec) throw new Error(`unsupported dimension '${name}' — not a registered dimension`);
    return spec;
  });
}

/**
 * Build the SQL for one metric request.
 *
 * The definition supplies every SQL fragment; the caller supplies only dates, a
 * grain and dimension *names*. Dimension names are looked up against the metric's
 * own declaration and then against DIMENSIONS, and rejected if unknown — no caller
 * string ever reaches the SQL text.
 */
export function buildMetricQuery(
  def: MetricDefinition,
  query: MetricQuery,
): { sql: string; params: unknown[] } {
  const selected = validateMetricQuery(def, query);

  const hasPeriod = query.grain !== 'range' && Boolean(def.dateColumn);
  // to_char, NOT ::date. node-postgres parses a DATE column (OID 1082) into a JS
  // Date object, and `String(thatDate).slice(0,10)` yields "Mon Jul 21" — not an
  // ISO date. That corrupts the API's `period` field AND breaks any lexical
  // comparison built on it (which is how the semi-additive total picks its
  // period). Returning text from SQL makes the value ISO by construction and
  // removes the JS date-marshalling step entirely.
  const periodExpr = hasPeriod
    ? `to_char(date_trunc('${GRAIN_TRUNC[query.grain as Exclude<Grain, 'range'>]}', ${def.dateColumn}), 'YYYY-MM-DD')`
    : 'NULL::text';

  const selectParts = [
    `${periodExpr} AS period`,
    ...selected.map((s) => `${s.expression} AS ${s.key}`),
    `${def.measure} AS value`,
  ];

  // ⚠️ GROUP BY / ORDER BY the EXPRESSIONS, never the output aliases.
  //
  // PostgreSQL resolves an unqualified GROUP BY name to an INPUT column first and
  // only falls back to an output alias when nothing matches. Every dimension alias
  // here collides with a column the metric's `src` subquery already exposes
  // (`project`, `zone`, ...), so `GROUP BY project` silently groups by the RAW
  // src.project instead of canonical_project(src.project).
  //
  // That does not error — it returns several rows carrying the SAME canonical
  // label with the count split between them, which is precisely the silent
  // mis-grouping the conformed dimension exists to prevent. Measured:
  //   GROUP BY project  -> Thembisa POP 1|1, Thembisa POP 1|1, Thembisa POP 1|1
  //   GROUP BY <expr>   -> Thembisa POP 1|3
  // for input ('TEM'),('Thembisa POP 1'),('tem'). It is latent rather than visible
  // today only because no two raw values in the current open snapshot fold to the
  // same canonical name — `oes_pp_data` already holds an 'ETW-2' row that would
  // split 'Etwatwa' in two the moment it appears in the open set.
  //
  // ORDER BY resolves aliases first, so it would have been safe — but naming the
  // expression in both keeps the two clauses provably consistent.
  const groupExprs = [...(hasPeriod ? [periodExpr] : []), ...selected.map((s) => s.expression)];

  const where: string[] = [];
  const params: unknown[] = [];
  if (def.dateColumn) {
    params.push(query.from, query.to);
    // HALF-OPEN, not BETWEEN. `to` arrives as a date; on a TIMESTAMP column
    // `BETWEEN '2026-07-01' AND '2026-07-31'` resolves the upper bound to
    // 2026-07-31 00:00:00 and silently discards ~24h of the final day.
    // `>= from AND < to + 1 day` is correct for both date and timestamp columns.
    where.push(`${def.dateColumn} >= $1::date AND ${def.dateColumn} < ($2::date + 1)`);
  }

  const sql = [
    `SELECT ${selectParts.join(', ')}`,
    `FROM ${def.from}`,
    where.length ? `WHERE ${where.join(' AND ')}` : '',
    groupExprs.length ? `GROUP BY ${groupExprs.join(', ')}` : '',
    groupExprs.length ? `ORDER BY ${groupExprs.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { sql, params };
}

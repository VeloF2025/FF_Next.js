/**
 * Metric registry types.
 *
 * A `MetricDefinition` is the whole contract between a business question and the
 * SQL that answers it. The definition supplies every SQL fragment; the caller
 * supplies only a key, a date range, a grain and dimension *names*. No caller
 * input is ever interpolated into SQL.
 */

export type Grain = 'day' | 'week' | 'month' | 'range';

export interface MetricDefinition {
  key: string;
  label: string;
  /** Prose shown in metrics-list so a caller can choose between near-neighbours. */
  description: string;
  /** FROM clause body, aliased as `src`. Must expose the columns its dimensions reference. */
  from: string;
  /** Aggregate expression, e.g. 'count(*)' or 'sum(src.installed)'. */
  measure: string;
  /** Column used for period filtering. Null means current-state-only. */
  dateColumn: string | null;
  /** Extra always-on predicate, without the WHERE keyword. */
  filter?: string;
  /**
   * How this measure may be aggregated. **The single most important field here.**
   *
   * Three review rounds of the plan each found a different instance of the same
   * error — summing something that cannot be summed over time — so this is a
   * required three-way choice, not an optional boolean. There is no default:
   * every metric must state its additivity explicitly, because guessing is what
   * caused the bug.
   *
   *  'additive'      Sum freely across time AND dimensions. An event count.
   *                  e.g. install_activation_gap — each row is a distinct event.
   *
   *  'semi-additive' Sum across DIMENSIONS but NEVER across time. A level, a
   *                  balance, a running total, or a point-in-time stock. The
   *                  value for a span is the LATEST period's value.
   *                  e.g. zone_uptake (a running total: 21,666 -> 22,556 ->
   *                  23,342 -> 23,732, so summing July reports 91,296 against a
   *                  true 23,732 — both measured on the live DB 2026-08-02) and
   *                  pp_open_balance (a nightly stock: an entity open for eight
   *                  nights appears in eight snapshots and would be counted
   *                  eight times).
   *
   *  'non-additive'  Cannot be summed at all — ratios, percentages, averages.
   *                  Must be recomputed from components at each grain. No metric
   *                  uses this yet; it exists so nobody reaches for 'additive'
   *                  when registering a rate.
   *
   * Nothing in the SQL reveals which applies. Read the source table's
   * documentation before choosing, and record why in the definition's comment.
   */
  additivity: 'additive' | 'semi-additive' | 'non-additive';
  grains: readonly Grain[];
  dimensions: readonly string[];
  aliases: readonly string[];
  /** Citation channel string — documents the predicate, shown to the user. */
  cite: string;
  /** RBAC resource checked before execution. */
  permission: string;
}

/**
 * Combining metric values — the arithmetic the operations read path does once a
 * month's numbers have been fetched, wherever they came from.
 *
 * Pure: no SQL, no clock, no scope. Both halves of the response (live facts and
 * released aggregates) are reduced to `OperationsMetricValue` before they get
 * here, so a month from either source folds the same way and a range spanning
 * the retention boundary cannot add up differently than one that does not.
 */
import type { OperationsMetricKey } from './aggregateSchema';
import type { DurationHistogram, OperationsMetricValue } from './types';

/**
 * A fresh accumulator for ONE month. Coverage starts at one month of one,
 * which is what a per-month value means; `foldToCards` recomputes it for a card
 * across the range, and never by summing, because two rows for the same key in
 * the same month (one per project) are still one month.
 */
export function emptyValue(metricKey: OperationsMetricKey): OperationsMetricValue {
  return { metricKey, numerator: 0, denominator: null, histogram: null, coverage: { months: 1, of: 1 } };
}

export function mergeHistograms(left: DurationHistogram | null, right: DurationHistogram): DurationHistogram {
  if (!left) return { ...right, buckets: [...right.buckets] };
  return {
    sampleCount: left.sampleCount + right.sampleCount,
    sumSeconds: left.sumSeconds + right.sumSeconds,
    buckets: left.buckets.map((count, index) => count + (right.buckets[index] ?? 0)),
  };
}

/**
 * Adds `value` into `target`.
 *
 * Ratios combine by summing numerators and denominators separately, never by
 * averaging the percentages: a month with four incidents and a month with four
 * hundred do not each contribute half of the answer.
 *
 * A null denominator stays null rather than becoming a zero. On a TOTAL_ONLY
 * aggregate the breakdown was withheld, so there is no population to divide by;
 * folding it in as zero would turn "we cannot say" into "out of none".
 *
 * `coverage` is deliberately untouched here. See `foldToCards`.
 */
export function accumulateValue(target: OperationsMetricValue, value: OperationsMetricValue): void {
  target.numerator += value.numerator;
  if (value.denominator !== null) target.denominator = (target.denominator ?? 0) + value.denominator;
  if (value.histogram) target.histogram = mergeHistograms(target.histogram, value.histogram);
}

/** Adds one value into a per-key list, creating the entry on first sight. */
export function upsertValue(values: OperationsMetricValue[], value: OperationsMetricValue): void {
  const existing = values.find((candidate) => candidate.metricKey === value.metricKey);
  const target = existing ?? emptyValue(value.metricKey);
  if (!existing) values.push(target);
  accumulateValue(target, value);
}

/**
 * Folds every month's values into one card per metric key, in a stable order.
 *
 * `coverage` is counted here rather than accumulated: it is the number of
 * MONTHS that reported the key, out of the months in the range. Summing it
 * through `accumulateValue` would double-count a restricted viewer's two
 * project rows for one month, and would report a card as covering more months
 * than the range holds.
 *
 * The months in the range are `series.length` — every month is present in the
 * series, including one that reported nothing at all, which is exactly the case
 * this field exists to expose.
 */
export function foldToCards(series: readonly { values: OperationsMetricValue[] }[]): OperationsMetricValue[] {
  const cards = new Map<OperationsMetricKey, OperationsMetricValue>();
  const monthsWithKey = new Map<OperationsMetricKey, number>();
  for (const month of series) {
    const seen = new Set<OperationsMetricKey>();
    for (const value of month.values) {
      const card = cards.get(value.metricKey) ?? emptyValue(value.metricKey);
      cards.set(value.metricKey, card);
      accumulateValue(card, value);
      if (!seen.has(value.metricKey)) {
        seen.add(value.metricKey);
        monthsWithKey.set(value.metricKey, (monthsWithKey.get(value.metricKey) ?? 0) + 1);
      }
    }
  }
  for (const [metricKey, card] of cards) {
    card.coverage = { months: monthsWithKey.get(metricKey) ?? 0, of: series.length };
  }
  return [...cards.values()].sort((a, b) => a.metricKey.localeCompare(b.metricKey));
}

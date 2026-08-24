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

export function emptyValue(metricKey: OperationsMetricKey): OperationsMetricValue {
  return { metricKey, numerator: 0, denominator: null, histogram: null };
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

/** Folds every month's values into one card per metric key, in a stable order. */
export function foldToCards(series: readonly { values: OperationsMetricValue[] }[]): OperationsMetricValue[] {
  const cards = new Map<OperationsMetricKey, OperationsMetricValue>();
  for (const month of series) {
    for (const value of month.values) {
      const card = cards.get(value.metricKey) ?? emptyValue(value.metricKey);
      cards.set(value.metricKey, card);
      accumulateValue(card, value);
    }
  }
  return [...cards.values()].sort((a, b) => a.metricKey.localeCompare(b.metricKey));
}

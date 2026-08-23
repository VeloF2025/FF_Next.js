/**
 * `metricKindFor` mirrors migration 518's `histogram_pairing` CHECK, which makes
 * `metric_key LIKE 'timing.%'` and `metric_kind = 'duration_histogram'` the same
 * condition.
 *
 * Getting this wrong does not produce a slightly wrong number - it produces a
 * constraint violation, which fails the whole month and, because retention
 * treats stored rows as proof of coverage, blocks purging that month forever.
 * So every metric key in the closed set is asserted here by name rather than by
 * sampling a couple of representatives.
 */
import { describe, expect, it } from 'vitest';
import {
  metricKindFor, OPERATIONS_METRIC_KEYS, TIMING_METRIC_KEYS,
} from '../aggregateSchema';

describe('metricKindFor', () => {
  it.each(TIMING_METRIC_KEYS)('makes %s a duration histogram whatever its denominator', (key) => {
    expect(metricKindFor(key, null)).toBe('duration_histogram');
    // The CHECK keys off the metric key alone, so a stray denominator must not
    // be able to turn a timing metric into a ratio.
    expect(metricKindFor(key, 10)).toBe('duration_histogram');
  });

  it('never calls a non-timing metric a duration histogram', () => {
    const nonTiming = OPERATIONS_METRIC_KEYS.filter((k) => !k.startsWith('timing.'));
    expect(nonTiming.length).toBeGreaterThan(0);
    for (const key of nonTiming) {
      expect(metricKindFor(key, null)).not.toBe('duration_histogram');
      expect(metricKindFor(key, 5)).not.toBe('duration_histogram');
    }
  });

  it('splits non-timing metrics on whether they have a denominator', () => {
    expect(metricKindFor('presence.scheduled_days', null)).toBe('count');
    expect(metricKindFor('presence.confirmed_days', 10)).toBe('ratio');
  });

  it('treats a zero denominator as a ratio, not as absent', () => {
    // 0 is a real denominator - a site with no incidents that month. Reading it
    // as "no denominator" would store the row as a count and lose the fact that
    // the population was empty rather than unmeasured.
    expect(metricKindFor('outcome.confirmed', 0)).toBe('ratio');
  });

  it('assigns every metric key in the closed set exactly one valid kind', () => {
    for (const key of OPERATIONS_METRIC_KEYS) {
      const withDenominator = metricKindFor(key, 1);
      const without = metricKindFor(key, null);
      expect(['count', 'ratio', 'duration_histogram']).toContain(withDenominator);
      expect(['count', 'ratio', 'duration_histogram']).toContain(without);
      // The migration's pairing CHECK: histogram-ness is a property of the KEY,
      // so it must not vary with the denominator for any key in the set.
      expect(withDenominator === 'duration_histogram').toBe(without === 'duration_histogram');
    }
  });
});

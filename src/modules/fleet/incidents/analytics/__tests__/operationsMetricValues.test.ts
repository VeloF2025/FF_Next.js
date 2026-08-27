/**
 * The arithmetic that folds months into cards.
 *
 * The denominator is the piece with teeth. A published TOTAL_ONLY row carries a
 * total with its breakdown withheld and no population to divide by, so its
 * denominator is null. Folding that in as a zero would turn "we cannot say"
 * into "out of none" — a ratio that reads as catastrophic rather than absent.
 */
import { describe, expect, it } from 'vitest';
import { foldToCards, mergeHistograms, upsertValue } from '../operationsMetricValues';
import type { OperationsMetricValue } from '../types';

function value(overrides: Partial<OperationsMetricValue> = {}): OperationsMetricValue {
  return {
    metricKey: 'incident.late', numerator: 1, denominator: null, histogram: null, ...overrides,
  };
}

describe('a withheld breakdown', () => {
  it('keeps a null denominator null rather than folding it in as zero', async () => {
    // A TOTAL_ONLY row has no population behind it. Zero would divide; null
    // says there is nothing to divide by.
    const cards = foldToCards([{ values: [value({ numerator: 20, denominator: null })] }]);
    expect(cards[0]?.denominator).toBeNull();
  });

  it('does not invent a denominator when only one of two months had one', () => {
    const cards = foldToCards([
      { values: [value({ numerator: 5, denominator: null })] },
      { values: [value({ numerator: 5, denominator: 10 })] },
    ]);
    // The month that reported one contributes it; the withheld month adds
    // nothing, and is not counted as ten more or as zero more.
    expect(cards[0]).toMatchObject({ numerator: 10, denominator: 10 });
  });
});

describe('the totals themselves', () => {
  it('sums numerators and denominators separately, never averaging the ratios', () => {
    const cards = foldToCards([
      { values: [value({ numerator: 1, denominator: 100 })] },
      { values: [value({ numerator: 1, denominator: 2 })] },
    ]);
    expect(cards[0]).toMatchObject({ numerator: 2, denominator: 102 });
  });

  it('leaves a denominator null when no month had one', () => {
    expect(foldToCards([{ values: [value()] }])[0]?.denominator).toBeNull();
  });

  it('merges histograms bucket by bucket rather than replacing them', () => {
    const merged = mergeHistograms(
      { sampleCount: 2, sumSeconds: 300, buckets: [2, 0, 0, 0, 0, 0] },
      { sampleCount: 3, sumSeconds: 900, buckets: [0, 3, 0, 0, 0, 0] },
    );
    expect(merged).toEqual({ sampleCount: 5, sumSeconds: 1200, buckets: [2, 3, 0, 0, 0, 0] });
  });

  it('orders cards by metric key, so two responses can be compared', () => {
    const cards = foldToCards([{
      values: [value({ metricKey: 'presence.scheduled_days' }), value({ metricKey: 'incident.late' })],
    }]);
    expect(cards.map((card) => card.metricKey)).toEqual(['incident.late', 'presence.scheduled_days']);
  });

  it('adds into an existing key rather than appending a second entry for it', () => {
    const values: OperationsMetricValue[] = [];
    upsertValue(values, value({ numerator: 2 }));
    upsertValue(values, value({ numerator: 3 }));
    expect(values).toHaveLength(1);
    expect(values[0]?.numerator).toBe(5);
  });
});

/**
 * The arithmetic that folds months into cards.
 *
 * `generalized` is the piece with teeth. It is the only field that is STICKY:
 * once any month behind a figure stood in for a group too small to publish, the
 * figure says so for good. Combining it like the numbers around it — last write
 * wins — produces a card that silently claims to be a total, which is exactly
 * the disclosure this module exists to avoid.
 */
import { describe, expect, it } from 'vitest';
import { accumulateValue, emptyValue, foldToCards, mergeHistograms, upsertValue } from '../operationsMetricValues';
import type { OperationsMetricValue } from '../types';

function value(overrides: Partial<OperationsMetricValue> = {}): OperationsMetricValue {
  return {
    metricKey: 'incident.late', numerator: 1, denominator: null, histogram: null,
    generalized: false, ...overrides,
  };
}

describe('generalized is sticky', () => {
  it('keeps a card generalized when the suppressed month comes FIRST', async () => {
    const cards = foldToCards([
      { values: [value({ numerator: 5, generalized: true })] },
      { values: [value({ numerator: 5, generalized: false })] },
    ]);
    expect(cards[0]?.generalized).toBe(true);
  });

  it('keeps a card generalized when the suppressed month comes LAST', async () => {
    const cards = foldToCards([
      { values: [value({ numerator: 5, generalized: false })] },
      { values: [value({ numerator: 5, generalized: true })] },
    ]);
    expect(cards[0]?.generalized).toBe(true);
  });

  it('leaves a card ungeneralized when no month behind it was', () => {
    const cards = foldToCards([{ values: [value()] }, { values: [value()] }]);
    expect(cards[0]?.generalized).toBe(false);
  });

  it('does not let a later clean value clear the flag on an accumulator', () => {
    const target = emptyValue('incident.late');
    accumulateValue(target, value({ generalized: true }));
    accumulateValue(target, value({ generalized: false }));
    expect(target.generalized).toBe(true);
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

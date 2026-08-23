/**
 * The digest that decides whether a recalculated month actually changed.
 *
 * If it collides, a changed month is stored as unchanged and the aggregate
 * silently goes stale; if it is unstable, every run rewrites every row. Both
 * failures are invisible in the run status, so they are tested here.
 */
import { describe, expect, it } from 'vitest';
import { checksumForAggregate } from '../aggregateChecksum';
import type { ReleasedAggregate } from '../suppression';

function row(overrides: Partial<ReleasedAggregate> = {}): ReleasedAggregate {
  return {
    monthStart: '2026-07-01',
    metricVersion: 1,
    dimensionLevel: 'site',
    dimensionProjectId: 'p1',
    dimensionSiteId: 's1',
    generalizedFromLevel: null,
    metricKey: 'presence.confirmed_days',
    metricKind: 'ratio',
    numerator: 1,
    denominator: 2,
    histogram: null,
    contributorCount: 6,
    ...overrides,
  };
}

describe('checksumForAggregate', () => {
  it('produces the shape the migration CHECK accepts', () => {
    expect(checksumForAggregate(row())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across calls and across key order', () => {
    const a = checksumForAggregate(row());
    const reordered: ReleasedAggregate = {
      contributorCount: 6,
      histogram: null,
      denominator: 2,
      numerator: 1,
      metricKind: 'ratio',
      metricKey: 'presence.confirmed_days',
      generalizedFromLevel: null,
      dimensionSiteId: 's1',
      dimensionProjectId: 'p1',
      dimensionLevel: 'site',
      metricVersion: 1,
      monthStart: '2026-07-01',
    };
    expect(checksumForAggregate(reordered)).toBe(a);
  });

  it('does not let adjacent numbers run together', () => {
    // 1|2 must not digest the same as 12|<absent>.
    const split = checksumForAggregate(row({ numerator: 1, denominator: 2 }));
    const joined = checksumForAggregate(row({ numerator: 12, denominator: null }));
    expect(split).not.toBe(joined);
  });

  it.each([
    ['monthStart', { monthStart: '2026-08-01' }],
    ['metricVersion', { metricVersion: 2 }],
    ['dimensionLevel', { dimensionLevel: 'project' as const, dimensionSiteId: null }],
    ['dimensionProjectId', { dimensionProjectId: 'p2' }],
    ['dimensionSiteId', { dimensionSiteId: 's2' }],
    ['generalizedFromLevel', { generalizedFromLevel: 'site' as const }],
    ['metricKey', { metricKey: 'presence.unconfirmed_days' as const }],
    ['metricKind', { metricKind: 'count' as const }],
    ['numerator', { numerator: 99 }],
    ['denominator', { denominator: 99 }],
    ['contributorCount', { contributorCount: 7 }],
  ])('changes when %s changes', (_label, overrides) => {
    expect(checksumForAggregate(row(overrides))).not.toBe(checksumForAggregate(row()));
  });

  it('covers every part of a histogram', () => {
    const base = row({
      metricKey: 'timing.acknowledgement',
      metricKind: 'duration_histogram',
      denominator: null,
      histogram: { sampleCount: 3, sumSeconds: 600, buckets: [1, 2, 0, 0, 0, 0] },
    });
    const digest = checksumForAggregate(base);

    expect(checksumForAggregate({ ...base, histogram: { sampleCount: 4, sumSeconds: 600, buckets: [1, 2, 0, 0, 0, 0] } })).not.toBe(digest);
    expect(checksumForAggregate({ ...base, histogram: { sampleCount: 3, sumSeconds: 601, buckets: [1, 2, 0, 0, 0, 0] } })).not.toBe(digest);
    // A bucket moving between slots keeps the sample count and the sum.
    expect(checksumForAggregate({ ...base, histogram: { sampleCount: 3, sumSeconds: 600, buckets: [2, 1, 0, 0, 0, 0] } })).not.toBe(digest);
  });

  it('ignores nothing that distinguishes two rows of the same month', () => {
    // Every site row of one metric in one month must digest differently, or a
    // changed site would be stored as unchanged.
    const digests = new Set(
      ['s1', 's2', 's3'].map((site) => checksumForAggregate(row({ dimensionSiteId: site }))),
    );
    expect(digests.size).toBe(3);
  });
});

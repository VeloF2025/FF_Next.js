/**
 * The two disclosures the blind review of PR #2604 reproduced, and the property
 * that has to hold for neither to come back.
 *
 * Both were invisible to the rules that existed because both rules asked "was
 * this published here?" where the reader asks "can I work this out from
 * anywhere?". The oracle in `derivabilityOracle.ts` asks the reader's question,
 * by row-reducing the whole system rather than by walking the suppression
 * algorithm a second time.
 */
import { describe, expect, it } from 'vitest';
import { releaseAnonymousGroups } from '../suppression';
import type { CalculatedMetricGroup } from '../facts';
import type { OperationsMetricKey } from '../aggregateSchema';
import { derivableLeaks } from './derivabilityOracle';

const MONTH = '2026-07-01';
const K = 5;

function group(
  metricKey: OperationsMetricKey, projectId: string, operationalSiteId: string,
  contributors: string[], numerator: number, denominator: number | null = null,
): CalculatedMetricGroup {
  return {
    monthStart: MONTH, metricVersion: 1, projectId, operationalSiteId, metricKey,
    numerator, denominator, histogram: null, contributors: new Set(contributors),
  };
}

const people = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index}`);

describe('chained differencing across a level and then across keys (blocker 1)', () => {
  /**
   * Exactly the configuration the review reproduced. Two sites of six people
   * each; s1 has ONE person with an unconfirmed day.
   *
   * The rules as they stood published: project confirmed 110 (cc 12), s1
   * scheduled 100 (cc 6), s2 confirmed 50 (cc 6), s1 vehicle-only 39 (cc 6),
   * project unconfirmed 6 (cc 6) — and withheld s1 confirmed, believing that
   * settled it. It does not:
   *
   *   110 - 50            = 60  -> s1 confirmed, never published
   *   100 - 60 - 39       =  1  -> s1 unconfirmed, one person, named site, named month
   */
  const s1 = people('a', 6);
  const s2 = people('b', 6);
  const chained: CalculatedMetricGroup[] = [
    group('presence.scheduled_days', 'p1', 's1', s1, 100),
    group('presence.confirmed_days', 'p1', 's1', s1, 60, 100),
    group('presence.vehicle_only_days', 'p1', 's1', s1, 39, 100),
    group('presence.unconfirmed_days', 'p1', 's1', [s1[0]!], 1, 100),
    group('presence.scheduled_days', 'p1', 's2', s2, 55),
    group('presence.confirmed_days', 'p1', 's2', s2, 50, 55),
    group('presence.unconfirmed_days', 'p1', 's2', s2.slice(0, 5), 5, 55),
  ];

  it('leaves nothing about a sub-k group recoverable', () => {
    expect(derivableLeaks(chained, releaseAnonymousGroups(chained, K), K)).toEqual([]);
  });

  it('does not hand s1 its own unconfirmed day back through the project', () => {
    const released = releaseAnonymousGroups(chained, K);
    const at = (level: string, key: string, site: string | null): number | undefined => released.find(
      (row) => row.dimensionLevel === level && row.metricKey === key && row.dimensionSiteId === site,
    )?.numerator;
    // Whatever survives, the three numbers that closed the chain cannot all be
    // present: project confirmed, s2 confirmed, and s1's own scheduled/vehicle.
    const chainIntact = at('project', 'presence.confirmed_days', null) !== undefined
      && at('site', 'presence.confirmed_days', 's2') !== undefined
      && at('site', 'presence.scheduled_days', 's1') !== undefined
      && at('site', 'presence.vehicle_only_days', 's1') !== undefined;
    expect(chainIntact).toBe(false);
  });

  it('is a real chain, not an artefact of a fixture nobody would publish', () => {
    // Every cell in the chain clears the threshold on its own, so only the
    // arithmetic — never a per-row count — exposes the one-person residual.
    expect(new Set(chained[0]!.contributors).size).toBeGreaterThanOrEqual(K);
    expect(new Set(chained[3]!.contributors).size).toBe(1);
  });
});

describe('nested subsets publish their complement (blocker 2)', () => {
  /**
   * `input.responses_received` counts a SUBSET of `input.requests_sent`, and no
   * partition covered the pair. Publishing both published the difference:
   * 6 requests, 5 responses, and one contributor in the first set who is absent
   * from the second — a single driver who answered nothing.
   */
  const roster = people('c', 6);
  const nested: CalculatedMetricGroup[] = [
    group('input.requests_sent', 'p1', 's1', roster, 6),
    group('input.responses_received', 'p1', 's1', roster.slice(0, 5), 5, 6),
  ];

  it('leaves nothing about a sub-k group recoverable', () => {
    expect(derivableLeaks(nested, releaseAnonymousGroups(nested, K), K)).toEqual([]);
  });

  it('does not publish both halves of the pair at any level', () => {
    const released = releaseAnonymousGroups(nested, K);
    for (const level of ['site', 'project', 'organisation']) {
      const keys = new Set(released.filter((row) => row.dimensionLevel === level).map((row) => row.metricKey));
      expect(keys.has('input.requests_sent') && keys.has('input.responses_received')).toBe(false);
    }
  });

  it('leaves the pair alone when nobody sits in the complement', () => {
    // Same numbers, but every contributor appears in both sets: the missing
    // response belongs to no identifiable subgroup.
    const shared: CalculatedMetricGroup[] = [
      group('input.requests_sent', 'p1', 's1', roster, 6),
      group('input.responses_received', 'p1', 's1', roster, 5, 6),
    ];
    const keys = new Set(releaseAnonymousGroups(shared, K)
      .filter((row) => row.dimensionLevel === 'site').map((row) => row.metricKey));
    expect(keys.has('input.requests_sent')).toBe(true);
    expect(keys.has('input.responses_received')).toBe(true);
  });
});

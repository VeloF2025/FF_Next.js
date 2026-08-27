/**
 * The whole pipeline, calculator through suppression, asserted on what actually
 * gets PUBLISHED.
 *
 * Every other test in this module stops at one stage. `metricCalculator.test.ts`
 * asserts contributor set sizes; `suppression.test.ts` feeds hand-built groups.
 * Neither can answer the only question that matters at the end: given real
 * facts, does any row that would reach the database describe too few people?
 *
 * That gap is not hypothetical. The defect this file's first test pins was
 * introduced BY the fix for an earlier one, survived both stage-local suites,
 * and was caught only by an adversarial reviewer running the two stages
 * together.
 *
 * Under the tier rule the histogram is doubly out of reach — a component
 * publishes nothing unless every variable in it clears the threshold, and
 * migration 527's view drops the histogram columns outright — but the assertion
 * stays, because it is the one that failed.
 */
import { describe, expect, it } from 'vitest';
import { calculateMonthly } from '../metricCalculator';
import { releaseAnonymousGroups } from '../suppression';
import type { OperationsFact } from '../facts';

const K = 5;

function rosterAt(site: string, size: number, workDate = '2026-07-14'): OperationsFact[] {
  return Array.from({ length: size }, (_, i) => ({
    kind: 'presence' as const,
    workDate,
    dimension: { projectId: 'p1', operationalSiteId: site },
    contributorKey: `${site}-${i}`,
    confirmation: 'confirmed' as const,
  }));
}

function incidentAt(site: string, staff: string, overrides: Record<string, unknown> = {}): OperationsFact {
  return {
    kind: 'incident',
    workDate: '2026-07-14',
    dimension: { projectId: 'p1', operationalSiteId: site },
    contributorKey: staff,
    incidentType: 'accident_sos',
    outcome: 'confirmed',
    acknowledgementSeconds: 137,
    reviewStartSeconds: 402,
    resolutionSeconds: 4271,
    driverResponseSeconds: 88,
    driverInputRequested: true,
    driverInputResponded: true,
    driverInputOnTime: true,
    evidenceAvailable: true,
    isRecurrence: false,
    ...overrides,
  } as OperationsFact;
}

/** Runs the real pipeline and returns what would be written. */
function publish(facts: OperationsFact[], k = K) {
  return releaseAnonymousGroups(calculateMonthly(facts, 1), k);
}

describe('end-to-end disclosure', () => {
  it('publishes NO row at ANY level carrying one person’s exact duration', () => {
    // Two sites of eight; a single incident by a single person at one of them.
    // The site row is withheld for support. The regression was the PARENT: it
    // unioned the other site's zero-support roster and published 4271 anyway.
    const facts = [
      ...rosterAt('s1', 8), ...rosterAt('s2', 8),
      incidentAt('s1', 's1-0'),
    ];

    const rows = publish(facts);

    const leaking = rows.filter((r) => r.histogram !== null && r.histogram.sampleCount > 0
      && r.histogram.sampleCount < K);
    expect(leaking).toEqual([]);
    // and specifically the value itself must appear nowhere
    expect(rows.some((r) => r.histogram?.sumSeconds === 4271)).toBe(false);
  });

  it('publishes no row whose contributor count is under the threshold', () => {
    const facts = [
      ...rosterAt('s1', 6), ...rosterAt('s2', 2), ...rosterAt('s3', 2),
      incidentAt('s1', 's1-0'), incidentAt('s2', 's2-0'),
    ];

    for (const row of publish(facts)) {
      expect(row.contributorCount).toBeGreaterThanOrEqual(K);
    }
  });

  it('publishes no site row for a parent to be differenced against', () => {
    // The old rule published site rows and then had to bound what subtracting
    // them from their parent left behind. Two two-person sites beside a large
    // one was the configuration that broke the first attempt at that bound. It
    // cannot arise now: the site rows do not exist.
    const facts = [
      ...rosterAt('big', 20), ...rosterAt('tiny-1', 2), ...rosterAt('tiny-2', 2),
    ];
    const rows = publish(facts);
    expect(rows.some((row) => row.dimensionLevel === 'site')).toBe(false);
    expect(rows.some((row) => row.dimensionLevel === 'project')).toBe(true);
  });

  it('honours a threshold above the schema floor end to end', () => {
    const facts = [...rosterAt('s1', 6), ...rosterAt('s2', 6)];
    // Twelve people across two sites of six: publishable at 5, not at 20.
    expect(publish(facts, 5).length).toBeGreaterThan(0);
    expect(publish(facts, 20)).toEqual([]);
    for (const row of publish(facts, 12)) expect(row.contributorCount).toBeGreaterThanOrEqual(12);
  });

  it('emits nothing at all from no facts', () => {
    expect(publish([])).toEqual([]);
  });
});

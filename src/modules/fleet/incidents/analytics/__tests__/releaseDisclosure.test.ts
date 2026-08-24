/**
 * The property the whole design exists for, and the three channels round 3 of
 * review found in the design before it.
 *
 * Judged by `releaseOracle.ts`, which solves the reader's system exactly and
 * rebuilds its relations from `DENOMINATOR_OF` rather than importing the model
 * it audits.
 */
import { describe, expect, it } from 'vitest';
import { PUBLISHED_VIEW_COLUMNS } from '../aggregateSchema';
import { calculateMonthly } from '../metricCalculator';
import { releaseAnonymousGroups } from '../suppression';
import { configurationFor, incident, monitorRun, notification, presence } from './factFixtures';
import { derivableLeaks } from './releaseOracle';
import type { OperationsFact } from '../facts';

const K = 5;

const leaksIn = (facts: readonly OperationsFact[]): string[] => {
  const siteMonths = calculateMonthly(facts, 1);
  return derivableLeaks(siteMonths, releaseAnonymousGroups(siteMonths, K), K);
};

describe('nothing below the threshold is derivable', () => {
  it('holds across 320 randomised months, facts through the real calculator', () => {
    let checked = 0;
    for (let seed = 1; seed <= 320; seed += 1) {
      const leaks = leaksIn(configurationFor(seed));
      if (leaks.length > 0) throw new Error(`seed ${seed}: ${leaks.slice(0, 3).join('; ')}`);
      checked += 1;
    }
    expect(checked).toBe(320);
  }, 60_000);
});

describe('the three channels round 3 reproduced', () => {
  /**
   * CONTRIBUTOR COUNT DIFFERENCING. `cc(presence.scheduled_days)` minus
   * `cc(presence.confirmed_days)` was 1 on 658 of 300 seeded months — one named
   * person, without touching a numerator. The column is not published, so the
   * channel is not narrowed, it is gone.
   */
  it('publishes no contributor count to difference', () => {
    expect([...PUBLISHED_VIEW_COLUMNS]).not.toContain('contributor_count');
    const roster = Array.from({ length: 6 }, (_, index) => `n-${index}`);
    const facts = roster.flatMap((person, index) => [
      presence('p1', 's1', person, 'confirmed'),
      // One person, and only one, also has an unconfirmed day.
      ...(index === 0 ? [presence('p1', 's1', person, 'unconfirmed')] : []),
    ]);
    // The row object still carries a contributor count — the base table's own
    // CHECK needs it — and that is precisely why the VIEW is where it is
    // dropped. Nothing a reader can reach has the column.
    expect(leaksIn(facts)).toEqual([]);
  });

  /**
   * HISTOGRAM BUCKET RESIDUALS. `sum_seconds` over a `sample_count` of one is
   * that person's exact duration, and bucket counts difference across levels the
   * way any other count does. No histogram column is published.
   */
  it('publishes no histogram column to residual', () => {
    const columns = [...PUBLISHED_VIEW_COLUMNS];
    expect(columns).not.toContain('sample_count');
    expect(columns).not.toContain('sum_seconds');
    expect(columns.filter((column) => column.startsWith('bucket_'))).toEqual([]);
    const roster = Array.from({ length: 8 }, (_, index) => `t-${index}`);
    const facts: OperationsFact[] = [
      ...roster.map((person) => presence('p1', 's1', person, 'confirmed')),
      // A single incident, by a single person, with real durations on it.
      incident('p1', 's1', roster[0]!, { resolutionSeconds: 4271 }),
    ];
    expect(leaksIn(facts)).toEqual([]);
  });

  /**
   * TWO-CELL COMBINATIONS. Four variables across two cells were pinned together
   * outside the previous guarantee's stated reach. The tier rule does not have a
   * reach: a component is published whole or not at all, and the organisation
   * takes the minimum tier over its projects, so `organisation - sum(projects)`
   * is zero rather than a residual.
   */
  it('leaves no two-cell combination to pin', () => {
    const facts: OperationsFact[] = [];
    // One project, two sites: a large one and a two-person one. The small site
    // is exactly the cell a reader would try to difference out of the project.
    for (let index = 0; index < 9; index += 1) {
      facts.push(presence('p1', 'big', `b-${index}`, index < 7 ? 'confirmed' : 'unconfirmed'));
    }
    for (let index = 0; index < 2; index += 1) {
      facts.push(presence('p1', 'small', `s-${index}`, 'confirmed'));
      facts.push(notification('p1', 'small', `s-${index}`, index === 0));
      facts.push(incident('p1', 'small', `s-${index}`, { outcome: index === 0 ? 'confirmed' : null }));
    }
    facts.push(monitorRun('p1', 'small', ['s-0'], false));
    expect(leaksIn(facts)).toEqual([]);
  });
});

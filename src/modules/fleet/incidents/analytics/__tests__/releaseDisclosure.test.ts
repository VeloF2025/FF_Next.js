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
import { checksumForAggregate } from '../aggregateChecksum';
import type { ReleasedAggregate } from '../suppression';
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

/**
 * The oracle solves the reader's whole system in exact integer arithmetic, which
 * is not cheap — roughly four tenths of a second per month. The unit suite runs
 * a slice small enough to stay out of the way; the extended sweep is one
 * variable away:
 *
 *     SEEDS=400 npx vitest run src/modules/fleet/incidents/analytics/__tests__/releaseDisclosure.test.ts
 *
 * The slice is not a sample of a fixed set — seeds are consecutive from 1, so
 * the unit run and the extended run agree on every month they share, and the
 * extended run is what a change to the release rule should be checked against.
 */
const SEEDS = Number(process.env['SEEDS'] ?? 32);

describe('nothing below the threshold is derivable', () => {
  it(`holds across ${SEEDS} randomised months, facts through the real calculator`, () => {
    let checked = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const leaks = leaksIn(configurationFor(seed));
      if (leaks.length > 0) throw new Error(`seed ${seed}: ${leaks.slice(0, 3).join('; ')}`);
      checked += 1;
    }
    expect(checked).toBe(SEEDS);
  }, 120_000);
});

/**
 * What a reader of the view actually holds for one row: the released row
 * projected onto the published column list, and nothing else.
 *
 * Driven by `PUBLISHED_VIEW_COLUMNS` rather than by a hand-written list, so
 * adding a column to the view adds it to the attack below too.
 */
function asPublished(row: ReleasedAggregate): Record<string, unknown> {
  const everything: Record<string, unknown> = {
    month_start: row.monthStart,
    metric_version: row.metricVersion,
    dimension_level: row.dimensionLevel,
    dimension_project_id: row.dimensionProjectId,
    dimension_site_id: row.dimensionSiteId,
    metric_key: row.metricKey,
    metric_kind: row.metricKind,
    numerator: row.numerator,
    denominator: row.denominator,
    contributor_count: row.contributorCount,
    sample_count: row.histogram?.sampleCount ?? null,
    sum_seconds: row.histogram?.sumSeconds ?? null,
    checksum: checksumForAggregate(row),
    is_active: true,
    id: 'a-uuid',
    aggregation_run_id: 'a-uuid',
    created_at: 'a-timestamp',
    updated_at: 'a-timestamp',
  };
  const published: Record<string, unknown> = {};
  for (const column of PUBLISHED_VIEW_COLUMNS) published[column] = everything[column];
  return published;
}

/**
 * The attack the checksum column enables: every field of the preimage except
 * the contributor count is published, so guess the count until the digest
 * matches. Returns what it recovered, or null.
 */
function bruteForceContributorCount(row: ReleasedAggregate, ceiling = 5_000): number | null {
  const published = asPublished(row);
  const target = published['checksum'];
  if (typeof target !== 'string') return null;
  for (let guess = 1; guess <= ceiling; guess += 1) {
    if (checksumForAggregate({ ...row, contributorCount: guess }) === target) return guess;
  }
  return null;
}

describe('the checksum is not a published column, because it is an encoding', () => {
  const roster = Array.from({ length: 9 }, (_, index) => `h-${index}`);
  const facts = roster.map((person) => presence('p1', 's1', person, 'confirmed'));

  it('leaves no way to recover a contributor count from what is published', () => {
    const released = releaseAnonymousGroups(calculateMonthly(facts, 1), K);
    expect(released.length).toBeGreaterThan(0);
    for (const row of released) {
      expect(bruteForceContributorCount(row)).toBeNull();
    }
  });

  it('is a real attack when the column is published — the guard is load-bearing', () => {
    // Proves the brute force works, so that the assertion above is passing
    // because the column is absent and not because the attack is broken.
    const [row] = releaseAnonymousGroups(calculateMonthly(facts, 1), K);
    const digest = checksumForAggregate(row!);
    let recovered: number | null = null;
    for (let guess = 1; guess <= 5_000; guess += 1) {
      if (checksumForAggregate({ ...row!, contributorCount: guess }) === digest) { recovered = guess; break; }
    }
    expect(recovered).toBe(row!.contributorCount);
  });
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
   * publishes only where every project is all-in or all-out and the projects
   * publishing nothing, aggregated into one virtual cell, clear the threshold
   * themselves — so `organisation - sum(publishing projects)` is that virtual
   * cell rather than an unbounded residual.
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

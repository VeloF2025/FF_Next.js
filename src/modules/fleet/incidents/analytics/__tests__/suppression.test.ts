/**
 * Anonymity release: what may leave the calculator and become a stored row.
 *
 * The threat these tests are written against is not "a row with four people in
 * it" — the aggregate table's CHECK already refuses that. It is DIFFERENCING:
 * subtracting the published children of a parent from the parent to recover the
 * one child that was withheld. A per-row threshold cannot see that, so it is
 * tested here, at the only layer that can.
 */
import { describe, expect, it } from 'vitest';
import { releaseAnonymousGroups } from '../suppression';
import type { CalculatedMetricGroup } from '../facts';
import { FORBIDDEN_AGGREGATE_COLUMN_TOKENS } from '../aggregateSchema';

const MONTH = '2026-07-01';

function group(
  projectId: string,
  operationalSiteId: string,
  contributors: string[],
  numerator: number,
  denominator: number | null = null,
): CalculatedMetricGroup {
  return {
    monthStart: MONTH,
    projectId,
    operationalSiteId,
    metricKey: 'presence.scheduled_days',
    numerator,
    denominator,
    histogram: null,
    contributors: new Set(contributors),
  };
}

function people(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
}

const K = 5;

describe('releaseAnonymousGroups', () => {
  it('releases a site whose group reaches the threshold', () => {
    const released = releaseAnonymousGroups([group('p1', 's1', people('a', 5), 50)], K);

    const site = released.find((r) => r.dimensionLevel === 'site');
    expect(site).toBeDefined();
    expect(site?.dimensionSiteId).toBe('s1');
    expect(site?.contributorCount).toBe(5);
    expect(site?.numerator).toBe(50);
    expect(site?.generalizedFromLevel).toBeNull();
  });

  it('withholds a site below the threshold and folds it into its project', () => {
    // Two sites so the complementary rule is not what does the folding here.
    const released = releaseAnonymousGroups(
      [
        group('p1', 'small', people('a', 3), 30),
        group('p1', 'big-1', people('b', 6), 60),
        group('p1', 'big-2', people('c', 7), 70),
      ],
      K,
    );

    expect(released.some((r) => r.dimensionSiteId === 'small')).toBe(false);

    const project = released.find((r) => r.dimensionLevel === 'project');
    expect(project?.numerator).toBe(160); // every site, published or not
    expect(project?.contributorCount).toBe(16);
    expect(project?.generalizedFromLevel).toBe('site');
  });

  it('THE DIFFERENCING GUARD: never leaves exactly one site withheld', () => {
    // p1 = one failing site (3) and two passing (6, 7). Publishing both passing
    // sites would make project - (6 + 7) == the withheld site, exactly.
    const released = releaseAnonymousGroups(
      [
        group('p1', 'small', people('a', 3), 30),
        group('p1', 'mid', people('b', 6), 60),
        group('p1', 'large', people('c', 7), 70),
      ],
      K,
    );

    const sites = released.filter((r) => r.dimensionLevel === 'site').map((r) => r.dimensionSiteId);
    // The smallest passing sibling is folded in alongside the failing site, so
    // the project's residual covers two sites and isolates neither.
    expect(sites).toEqual(['large']);

    const project = released.find((r) => r.dimensionLevel === 'project');
    const publishedSiteTotal = released
      .filter((r) => r.dimensionLevel === 'site')
      .reduce((sum, r) => sum + r.numerator, 0);
    const residual = (project?.numerator ?? 0) - publishedSiteTotal;
    expect(residual).toBe(90); // 30 + 60 — two sites, not one
  });

  it('breaks the complementary tie deterministically, smallest then lowest id', () => {
    const first = releaseAnonymousGroups(
      [
        group('p1', 'small', people('a', 3), 30),
        group('p1', 'zz-tie', people('b', 6), 60),
        group('p1', 'aa-tie', people('c', 6), 61),
        group('p1', 'largest', people('d', 9), 90),
      ],
      K,
    );
    // Two siblings tie at 6 contributors; the lower id is the one folded.
    const sites = first.filter((r) => r.dimensionLevel === 'site').map((r) => r.dimensionSiteId);
    expect(sites).toEqual(['largest', 'zz-tie']);
  });

  it('generalizes a project below the threshold to the organisation', () => {
    const released = releaseAnonymousGroups(
      [
        group('tiny', 's1', people('a', 2), 20),
        group('big-1', 's2', people('b', 6), 60),
        group('big-2', 's3', people('c', 7), 70),
      ],
      K,
    );

    expect(released.some((r) => r.dimensionProjectId === 'tiny')).toBe(false);

    const org = released.find((r) => r.dimensionLevel === 'organisation');
    expect(org?.numerator).toBe(150);
    expect(org?.contributorCount).toBe(15);
    expect(org?.generalizedFromLevel).toBe('project');
    expect(org?.dimensionProjectId).toBeNull();
    expect(org?.dimensionSiteId).toBeNull();
  });

  it('applies the differencing guard at project level too', () => {
    const released = releaseAnonymousGroups(
      [
        group('tiny', 's1', people('a', 2), 20),
        group('mid', 's2', people('b', 6), 60),
        group('large', 's3', people('c', 8), 80),
      ],
      K,
    );

    const projects = released
      .filter((r) => r.dimensionLevel === 'project')
      .map((r) => r.dimensionProjectId);
    expect(projects).toEqual(['large']);
  });

  it('omits everything when the organisation itself is below the threshold', () => {
    const released = releaseAnonymousGroups(
      [group('p1', 's1', people('a', 2), 20), group('p2', 's2', people('b', 2), 20)],
      K,
    );
    expect(released).toEqual([]);
  });

  it('counts a contributor working two sites once at the parent', () => {
    // 'shared-0' appears at both sites. The parent must union, not add.
    const released = releaseAnonymousGroups(
      [
        group('p1', 's1', ['shared-0', ...people('a', 5)], 60),
        group('p1', 's2', ['shared-0', ...people('b', 5)], 60),
      ],
      K,
    );

    const project = released.find((r) => r.dimensionLevel === 'project');
    expect(project?.contributorCount).toBe(11); // 12 memberships, 11 people
    const org = released.find((r) => r.dimensionLevel === 'organisation');
    expect(org?.contributorCount).toBe(11);
  });

  it('sums a folded site into its parent exactly once', () => {
    const released = releaseAnonymousGroups(
      [
        group('p1', 'small', people('a', 3), 30),
        group('p1', 'mid', people('b', 6), 60),
        group('p1', 'large', people('c', 7), 70),
      ],
      K,
    );
    const org = released.find((r) => r.dimensionLevel === 'organisation');
    expect(org?.numerator).toBe(160);
  });

  it('keeps each month and metric key independent', () => {
    const other: CalculatedMetricGroup = {
      ...group('p1', 's1', people('a', 6), 12),
      monthStart: '2026-08-01',
    };
    const released = releaseAnonymousGroups([group('p1', 's1', people('a', 6), 50), other], K);
    const months = released.map((r) => r.monthStart);
    expect(new Set(months)).toEqual(new Set(['2026-07-01', '2026-08-01']));
    expect(released.filter((r) => r.monthStart === '2026-08-01' && r.dimensionLevel === 'site')[0]?.numerator).toBe(12);
  });

  it('merges denominators and histograms when folding', () => {
    const withHistogram = (site: string, contributors: string[], buckets: number[], sum: number) => ({
      ...group('p1', site, contributors, 0, null),
      metricKey: 'timing.acknowledgement' as const,
      histogram: { sampleCount: buckets.reduce((a, b) => a + b, 0), sumSeconds: sum, buckets },
    });

    const released = releaseAnonymousGroups(
      [
        withHistogram('small', people('a', 3), [1, 0, 0, 0, 0, 0], 100),
        withHistogram('mid', people('b', 6), [0, 2, 0, 0, 0, 0], 900),
        withHistogram('large', people('c', 7), [0, 0, 3, 0, 0, 0], 3000),
      ],
      K,
    );

    const project = released.find((r) => r.dimensionLevel === 'project');
    expect(project?.histogram).toEqual({ sampleCount: 6, sumSeconds: 4000, buckets: [1, 2, 3, 0, 0, 0] });
  });

  it('emits no key that the aggregate column allow-list forbids', () => {
    const released = releaseAnonymousGroups([group('p1', 's1', people('a', 6), 50)], K);
    const keys = released.flatMap((row) => Object.keys(row));

    for (const key of keys) {
      const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      // dimensionProjectId/dimensionSiteId are the two allowed identity-shaped
      // keys: they name a place, not a person, and the migration permits them.
      if (snake === 'dimension_project_id' || snake === 'dimension_site_id') continue;
      for (const token of FORBIDDEN_AGGREGATE_COLUMN_TOKENS) {
        expect(snake).not.toContain(token);
      }
    }
  });

  it('carries no contributor identity off the calculator', () => {
    const released = releaseAnonymousGroups([group('p1', 's1', people('a', 6), 50)], K);
    const serialized = JSON.stringify(released);
    expect(serialized).not.toContain('a-0');
    for (const row of released) {
      expect(Object.values(row).some((v) => v instanceof Set || Array.isArray(v))).toBe(false);
    }
  });

  it('honours a threshold above the floor', () => {
    const released = releaseAnonymousGroups([group('p1', 's1', people('a', 6), 50)], 8);
    // Six clears five but not eight, so nothing at any level may be released.
    expect(released).toEqual([]);
  });
});

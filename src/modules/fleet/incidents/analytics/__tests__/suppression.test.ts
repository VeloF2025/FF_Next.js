/**
 * The tier rule: which rows may leave the calculator and become stored rows.
 *
 * The threat is not "a row with four people in it" — the aggregate table's CHECK
 * already refuses that. It is DIFFERENCING, and the answer is no longer to
 * publish cautiously and then search for what a reader could recover. A
 * component is published whole, or reduced to its root total, or not at all; and
 * the organisation takes the minimum tier over its projects, so
 * `organisation - sum(projects)` is zero rather than a residual.
 *
 * Facts go through the real calculator, never hand-built groups: the complements
 * the rule turns on are COUNTED there, and reconstructing them from contributor
 * sets is exactly what was wrong with the design this replaced.
 */
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_AGGREGATE_COLUMN_TOKENS } from '../aggregateSchema';
import { calculateMonthly } from '../metricCalculator';
import { releaseAnonymousGroups, releaseTiers } from '../suppression';
import type { OperationsFact } from '../facts';
import { incident, notification, presence } from './factFixtures';

const K = 5;

const release = (facts: OperationsFact[], k = K) => releaseAnonymousGroups(calculateMonthly(facts, 1), k);
const tiersOf = (facts: OperationsFact[], k = K) => releaseTiers(calculateMonthly(facts, 1), k);

/** A roster whose presence is entirely confirmed: every presence variable clears. */
function confirmedRoster(projectId: string, siteId: string, size: number): OperationsFact[] {
  return Array.from({ length: size }, (_, index) => presence(projectId, siteId, `${siteId}-${index}`, 'confirmed'));
}

describe('what the tier rule publishes', () => {
  it('publishes a whole component when every variable in it clears the threshold', () => {
    const released = release(confirmedRoster('p1', 's1', 7));
    const keys = released.filter((row) => row.dimensionLevel === 'project').map((row) => row.metricKey);
    // `presence.unconfirmed_days` and `presence.vehicle_only_days` have nobody
    // behind them, so they are zero and not stored; the total and the confirmed
    // days are the component's whole publishable content.
    expect(keys.sort()).toEqual(['presence.confirmed_days', 'presence.scheduled_days']);
    const confirmed = released.find((row) => row.metricKey === 'presence.confirmed_days');
    expect(confirmed?.denominator).toBe(7);
  });

  it('falls back to the root total alone when a member does not clear', () => {
    // Six people confirmed, ONE of whom also has an unconfirmed day. The
    // unconfirmed member describes one person, so the component cannot be
    // published whole — but `presence.scheduled_days` still covers six.
    const facts = [
      ...confirmedRoster('p1', 's1', 6),
      presence('p1', 's1', 's1-0', 'unconfirmed'),
    ];
    const released = release(facts);
    const keys = released.filter((row) => row.dimensionLevel === 'project').map((row) => row.metricKey);
    expect(keys).toEqual(['presence.scheduled_days']);
    expect(released.every((row) => row.denominator === null)).toBe(true);
    expect(tiersOf(facts).get('2026-07-01|project|p1|presence.scheduled_days')).toBe('total_only');
  });

  it('publishes nothing when even the root total is too small', () => {
    const facts = confirmedRoster('p1', 's1', 3);
    expect(release(facts)).toEqual([]);
    expect(tiersOf(facts).get('2026-07-01|project|p1|presence.scheduled_days')).toBe('none');
  });

  it('never publishes a site row, however large the site', () => {
    const released = release(confirmedRoster('p1', 's1', 40));
    expect(released.some((row) => row.dimensionLevel === 'site')).toBe(false);
    expect(released.every((row) => row.dimensionSiteId === null)).toBe(true);
  });
});

describe('the organisation takes the minimum tier over its projects', () => {
  const mixed = (): OperationsFact[] => [
    // p1 is clean: every presence variable clears.
    ...confirmedRoster('p1', 'a', 8),
    // p2 has one person with an unconfirmed day, so it can only reach TOTAL_ONLY.
    ...confirmedRoster('p2', 'b', 6),
    presence('p2', 'b', 'b-0', 'unconfirmed'),
  ];

  it('drops the organisation to the weaker project’s tier', () => {
    const tiers = tiersOf(mixed());
    expect(tiers.get('2026-07-01|project|p1|presence.scheduled_days')).toBe('full');
    expect(tiers.get('2026-07-01|project|p2|presence.scheduled_days')).toBe('total_only');
    expect(tiers.get('2026-07-01|organisation||presence.scheduled_days')).toBe('total_only');
  });

  it('leaves the difference across levels at exactly zero', () => {
    // This is the whole proof, checked rather than asserted: every key the
    // organisation publishes is published by EVERY project, so subtracting the
    // projects from the organisation yields nothing that was withheld.
    const released = release(mixed());
    const organisation = released.filter((row) => row.dimensionLevel === 'organisation');
    for (const row of organisation) {
      const projects = released.filter(
        (candidate) => candidate.dimensionLevel === 'project' && candidate.metricKey === row.metricKey,
      );
      expect(projects.map((project) => project.dimensionProjectId).sort()).toEqual(['p1', 'p2']);
      expect(projects.reduce((total, project) => total + project.numerator, 0)).toBe(row.numerator);
    }
  });
});

describe('the rows themselves', () => {
  it('carries no contributor identity and no forbidden token', () => {
    const released = release(confirmedRoster('p1', 's1', 9));
    expect(released.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(released).toLowerCase();
    for (const token of FORBIDDEN_AGGREGATE_COLUMN_TOKENS) {
      if (token === 'name' || token === 'point') continue; // substrings of ordinary words
      expect(serialized).not.toContain(`"${token}`);
    }
    expect(serialized).not.toContain('s1-0');
  });

  it('produces byte-identical rows on a re-run, so the checksum settles', () => {
    const facts = [
      ...confirmedRoster('p1', 's1', 7),
      ...Array.from({ length: 6 }, (_, index) => incident('p1', 's1', `s1-${index}`)),
      ...Array.from({ length: 6 }, (_, index) => notification('p1', 's1', `s1-${index}`, index < 5)),
    ];
    expect(JSON.stringify(release(facts))).toBe(JSON.stringify(release(facts)));
  });

  it('honours a threshold above the schema floor', () => {
    const facts = confirmedRoster('p1', 's1', 7);
    expect(release(facts, 5).length).toBeGreaterThan(0);
    expect(release(facts, 9)).toEqual([]);
  });
});

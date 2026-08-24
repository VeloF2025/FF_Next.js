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
function confirmedRoster(projectId: string, prefix: string, size: number): OperationsFact[] {
  return Array.from({ length: size }, (_, index) => presence(projectId, prefix, `${prefix}-${index}`, 'confirmed'));
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

describe('the organisation asks whether what it leaves behind is safe to leave', () => {
  const mixed = (): OperationsFact[] => [
    // p1 is clean: every presence variable clears.
    ...confirmedRoster('p1', 'a', 8),
    // p2 has one person with an unconfirmed day, so it can only reach TOTAL_ONLY.
    ...confirmedRoster('p2', 'b', 6),
    presence('p2', 'b', 'b-0', 'unconfirmed'),
  ];

  it('publishes only what every surviving project also publishes', () => {
    const tiers = tiersOf(mixed());
    expect(tiers.get('2026-07-01|project|p1|presence.scheduled_days')).toBe('full');
    expect(tiers.get('2026-07-01|project|p2|presence.scheduled_days')).toBe('total_only');
    // Nothing is withheld at TOTAL_ONLY — both projects reach it — so the
    // organisation publishes there and the difference across levels is zero.
    expect(tiers.get('2026-07-01|organisation||presence.scheduled_days')).toBe('total_only');
  });

  it('leaves the difference across levels at exactly zero', () => {
    // The proof, checked rather than asserted: every key the organisation
    // publishes is published by every project that is not in the virtual cell,
    // so subtracting them yields the virtual cell — here, nothing.
    const released = release(mixed());
    const organisation = released.filter((row) => row.dimensionLevel === 'organisation');
    expect(organisation.length).toBeGreaterThan(0);
    for (const row of organisation) {
      const projects = released.filter(
        (candidate) => candidate.dimensionLevel === 'project' && candidate.metricKey === row.metricKey,
      );
      expect(projects.map((project) => project.dimensionProjectId).sort()).toEqual(['p1', 'p2']);
      expect(projects.reduce((total, project) => total + project.numerator, 0)).toBe(row.numerator);
    }
  });

  it('publishes over two withheld projects whose people together clear the threshold', () => {
    // Neither small project can publish anything: three people each. Their
    // AGGREGATE is six, so the residual an organisation row leaves describes
    // six people and is safe. Taking the minimum tier refused this outright.
    const facts = [
      ...confirmedRoster('big', 'b', 9),
      ...confirmedRoster('small-a', 'a', 3),
      ...confirmedRoster('small-b', 'z', 3),
    ];
    const tiers = tiersOf(facts);
    expect(tiers.get('2026-07-01|project|small-a|presence.scheduled_days')).toBe('none');
    expect(tiers.get('2026-07-01|project|small-b|presence.scheduled_days')).toBe('none');
    expect(tiers.get('2026-07-01|organisation||presence.scheduled_days')).toBe('full');
  });

  it('refuses when the single withheld project is the residual and cannot clear', () => {
    // One withheld project means the virtual cell IS that project, so it has to
    // pass in full. Four people never will, and no rule can publish an
    // organisation row whose residual is those four.
    const facts = [...confirmedRoster('big', 'b', 9), ...confirmedRoster('tiny', 't', 4)];
    const tiers = tiersOf(facts);
    expect(tiers.get('2026-07-01|project|tiny|presence.scheduled_days')).toBe('none');
    expect(tiers.get('2026-07-01|organisation||presence.scheduled_days')).toBe('none');
  });

  it('refuses FULL when the silent projects aggregate to a small COMPLEMENT', () => {
    // Six people between two silent projects, so every member of the
    // notifications component clears in the aggregate: sent by six, delivered
    // by six. What does not clear is the difference — the notifications that
    // FAILED belong to two people. Publishing the organisation's whole
    // component hands the reader that aggregate's sent and delivered, and
    // therefore their difference, over those two.
    //
    // Nothing in the member supports says so; the complement is counted
    // separately by `metricCalculator` precisely because it cannot be inferred
    // from them. A virtual-cell check that looked only at members would publish
    // this.
    const facts: OperationsFact[] = [
      ...confirmedRoster('big', 'b', 9),
      ...Array.from({ length: 9 }, (_, index) => notification('big', 'b', `b-${index}`, true)),
      // FIVE of the big project's people also had one that failed, so the
      // ORGANISATION's own complement clears and its own check cannot be what
      // refuses. What is left to refuse is the virtual cell.
      ...Array.from({ length: 5 }, (_, index) => notification('big', 'b', `b-${index}`, false)),
    ];
    for (const [project, prefix] of [['silent-a', 'a'], ['silent-b', 'z']] as const) {
      facts.push(...confirmedRoster(project, prefix, 3));
      for (let index = 0; index < 3; index += 1) {
        facts.push(notification(project, prefix, `${prefix}-${index}`, true));
      }
      // One person at each: a notification that did not arrive.
      facts.push(notification(project, prefix, `${prefix}-0`, false));
    }
    const tiers = tiersOf(facts);
    expect(tiers.get('2026-07-01|project|silent-a|reliability.notifications_sent')).toBe('none');
    expect(tiers.get('2026-07-01|project|silent-b|reliability.notifications_sent')).toBe('none');
    // The root still clears in the aggregate, so the total may be published —
    // but not the members.
    expect(tiers.get('2026-07-01|organisation||reliability.notifications_sent')).toBe('total_only');
  });

  it('refuses FULL when the single withheld project fails only a complement', () => {
    // `mid` clears every support but has a one-person unconfirmed complement,
    // so it reaches TOTAL_ONLY and not FULL. The organisation may not publish
    // the whole component over it: the reader would recover mid's entire
    // component, complement included.
    const facts = [
      ...confirmedRoster('big', 'b', 9),
      ...confirmedRoster('mid', 'm', 6),
      presence('mid', 'm', 'm-0', 'unconfirmed'),
    ];
    const tiers = tiersOf(facts);
    expect(tiers.get('2026-07-01|project|mid|presence.scheduled_days')).toBe('total_only');
    expect(tiers.get('2026-07-01|organisation||presence.scheduled_days')).toBe('total_only');
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

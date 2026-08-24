/**
 * Partition-aware suppression: the blocking open item in
 * `.claude/modules/fleet-analytics-disclosure.md`.
 *
 * `suppression.ts` compares siblings within ONE metric key. But the keys are not
 * independent of one another — three families of them sum to a total that is
 * itself published, as a row of its own or as the shared denominator on every
 * surviving member. So withholding one member while publishing its siblings AND
 * their total hands the withheld value back by subtraction, and the per-key
 * residual rule cannot see it because it never looks across keys.
 *
 * The property every test here defends:
 *
 *   for each (month, version, cell) and each partition, let W be the members
 *   that hold data but published no row. Either W's combined support is empty
 *   (the withheld members are all zero, which exposes nobody) or it covers at
 *   least `k` people.
 */
import { describe, expect, it } from 'vitest';
import { releaseAnonymousGroups } from '../suppression';
import { METRIC_PARTITIONS, partitionSacrifices, totalCarriersOf } from '../metricPartitions';
import type { CalculatedMetricGroup } from '../facts';
import type { OperationsMetricKey } from '../aggregateSchema';
import type { ReleasedAggregate } from '../suppression';

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

function people(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

function cellOf(row: ReleasedAggregate): string {
  return `${row.monthStart}|${row.metricVersion}|${row.dimensionLevel}|${row.dimensionProjectId ?? ''}|${row.dimensionSiteId ?? ''}`;
}

/**
 * The disclosure property, checked directly against the inputs — the only place
 * contributor identity still exists — rather than against the counts on the
 * rows, which is exactly the information a reader does not have.
 */
function partitionViolations(groups: readonly CalculatedMetricGroup[], released: readonly ReleasedAggregate[], k: number): string[] {
  const publishedCells = new Set(released.map((row) => `${cellOf(row)}|${row.metricKey}`));
  const violations: string[] = [];

  // Every cell any row was published into, plus the site/project cells each
  // group belongs to, so a fully-withheld cell is examined too.
  const cells = new Map<string, { level: string; projectId: string | null; siteId: string | null }>();
  for (const row of released) {
    cells.set(cellOf(row), { level: row.dimensionLevel, projectId: row.dimensionProjectId, siteId: row.dimensionSiteId });
  }

  for (const [cellId, cell] of cells) {
    const inCell = (candidate: CalculatedMetricGroup): boolean => {
      if (cell.level === 'organisation') return true;
      if (cell.level === 'project') return candidate.projectId === cell.projectId;
      return candidate.projectId === cell.projectId && candidate.operationalSiteId === cell.siteId;
    };
    for (const partition of METRIC_PARTITIONS) {
      const residual = new Set<string>();
      let anyMemberPublished = false;
      for (const member of partition.members) {
        const memberGroups = groups.filter((candidate) => candidate.metricKey === member && inCell(candidate));
        if (memberGroups.length === 0) continue;
        if (publishedCells.has(`${cellId}|${member}`)) { anyMemberPublished = true; continue; }
        for (const memberGroup of memberGroups) {
          for (const contributor of memberGroup.contributors) residual.add(contributor);
        }
      }
      const totalKnown = anyMemberPublished
        || totalCarriersOf(partition).some((carrier) => publishedCells.has(`${cellId}|${carrier}`));
      if (totalKnown && residual.size > 0 && residual.size < k) {
        violations.push(`${cellId} ${partition.members[0]}… residual=${residual.size}`);
      }
    }
  }
  return violations;
}

describe('the leak this closes, reproduced from the disclosure note', () => {
  // presence: 160 scheduled − 157 confirmed − 0 vehicle-only = 3 unconfirmed days,
  // and the support behind that 3 is one person at a named site in a named month.
  const staff = people('a', 5);
  const leak = [
    group('presence.scheduled_days', 'p1', 's1', staff, 160),
    group('presence.confirmed_days', 'p1', 's1', staff, 157, 160),
    group('presence.unconfirmed_days', 'p1', 's1', [staff[0]!], 3, 160),
  ];

  it('no longer lets the withheld member be recovered by subtraction', () => {
    const released = releaseAnonymousGroups(leak, K);
    expect(partitionViolations(leak, released, K)).toEqual([]);
  });

  it('does it by withholding a sibling, not by publishing the withheld member', () => {
    const released = releaseAnonymousGroups(leak, K);
    const keys = new Set(released.filter((row) => row.dimensionLevel === 'site').map((row) => row.metricKey));
    expect(keys.has('presence.unconfirmed_days')).toBe(false);
    expect(keys.has('presence.confirmed_days')).toBe(false);
  });

  it('reproduces the leak when the partition rule is not applied — the guard is load-bearing', () => {
    // Sanity check on the fixture itself: confirmed and scheduled both clear k on
    // their own, so nothing but the partition rule can withhold confirmed.
    expect(new Set(leak[1]!.contributors).size).toBeGreaterThanOrEqual(K);
    expect(new Set(leak[2]!.contributors).size).toBeLessThan(K);
  });
});

describe('the incident partition', () => {
  it('withholds enough incident members that the total cannot single one out', () => {
    const staff = people('b', 6);
    const groups = [
      group('incident.late', 'p1', 's1', staff, 8, 10),
      group('incident.accident_sos', 'p1', 's1', [staff[0]!], 2, 10),
      group('reliability.evidence_available', 'p1', 's1', staff, 7, 10),
    ];
    const released = releaseAnonymousGroups(groups, K);
    expect(partitionViolations(groups, released, K)).toEqual([]);
  });

  it('leaves a partition alone when every member clears the threshold on its own', () => {
    const groups = [
      group('incident.late', 'p1', 's1', people('c', 6), 6, 12),
      group('incident.wrong_site', 'p1', 's1', people('d', 6), 6, 12),
    ];
    const released = releaseAnonymousGroups(groups, K);
    const siteKeys = released.filter((row) => row.dimensionLevel === 'site').map((row) => row.metricKey).sort();
    expect(siteKeys).toEqual(['incident.late', 'incident.wrong_site']);
  });

  it('leaves a partition alone when the withheld members are all zero-support', () => {
    // Nothing to recover: subtracting the published members from the total
    // yields zero, which says only that nobody did the withheld things.
    const staff = people('e', 6);
    const groups = [
      group('incident.late', 'p1', 's1', staff, 9, 9),
      group('incident.wrong_site', 'p1', 's1', [], 0, 9),
    ];
    const released = releaseAnonymousGroups(groups, K);
    const siteKeys = released.filter((row) => row.dimensionLevel === 'site').map((row) => row.metricKey);
    expect(siteKeys).toContain('incident.late');
  });
});

describe('how the partition rule chooses what to sacrifice', () => {
  it('sacrifices the smallest published member first', () => {
    const wide = people('f', 9);
    const groups = [
      group('outcome.confirmed', 'p1', 's1', wide, 9, 12),
      group('outcome.valid_reason', 'p1', 's1', wide.slice(0, 5), 5, 12),
      group('outcome.false_positive', 'p1', 's1', [wide[0]!], 1, 12),
    ];
    const released = releaseAnonymousGroups(groups, K);
    const siteKeys = new Set(released.filter((row) => row.dimensionLevel === 'site').map((row) => row.metricKey));
    // valid_reason (5 people) is sacrificed before confirmed (9 people).
    expect(siteKeys.has('outcome.valid_reason')).toBe(false);
    expect(partitionViolations(groups, released, K)).toEqual([]);
  });

  it('produces byte-identical rows on a re-run, so the checksum settles', () => {
    const staff = people('g', 7);
    const groups = [
      group('outcome.confirmed', 'p1', 's1', staff, 7, 10),
      group('outcome.duplicate', 'p1', 's1', staff.slice(0, 5), 5, 10),
      group('outcome.data_gap', 'p1', 's1', [staff[1]!], 1, 10),
    ];
    expect(JSON.stringify(releaseAnonymousGroups(groups, K)))
      .toBe(JSON.stringify(releaseAnonymousGroups(groups, K)));
  });
});

describe('the partition rule and the cross-level rule together', () => {
  it('never leaves a site row for a key whose project row it withheld', () => {
    const staff = people('h', 6);
    const groups = [
      group('presence.scheduled_days', 'p1', 's1', staff, 100),
      group('presence.confirmed_days', 'p1', 's1', staff, 97, 100),
      group('presence.unconfirmed_days', 'p1', 's1', [staff[0]!], 3, 100),
    ];
    const released = releaseAnonymousGroups(groups, K);
    const projectKeys = new Set(released.filter((row) => row.dimensionLevel === 'project').map((row) => row.metricKey));
    for (const row of released.filter((r) => r.dimensionLevel === 'site')) {
      expect(projectKeys.has(row.metricKey)).toBe(true);
    }
  });

  it('withdraws a child the partition rule withheld its parent for', () => {
    // s1 has no unconfirmed data at all, so its own partition is clean and the
    // per-key rule publishes `confirmed` there. s2's single small unconfirmed
    // group forces `confirmed` to be sacrificed at s2, at the project, and at
    // the organisation — which leaves s1's row as a published child of a
    // withheld parent unless the withholding is cascaded down.
    const groups = [
      group('presence.scheduled_days', 'p1', 's1', people('m', 6), 60),
      group('presence.scheduled_days', 'p1', 's2', people('n', 6), 60),
      group('presence.confirmed_days', 'p1', 's1', people('m', 6), 60, 60),
      group('presence.confirmed_days', 'p1', 's2', people('n', 6), 58, 60),
      group('presence.unconfirmed_days', 'p1', 's2', people('n', 2), 2, 60),
    ];
    const released = releaseAnonymousGroups(groups, K);
    const confirmed = released.filter((row) => row.metricKey === 'presence.confirmed_days');
    const levels = new Set(confirmed.map((row) => row.dimensionLevel));
    expect(levels.has('project')).toBe(false);
    expect(levels.has('organisation')).toBe(false);
    // ...and therefore no site row for it either.
    expect(confirmed).toEqual([]);
  });

  it('holds the property at project and organisation level, not only at site level', () => {
    const groups = [
      group('presence.scheduled_days', 'p1', 's1', people('i', 6), 60),
      group('presence.scheduled_days', 'p1', 's2', people('j', 6), 60),
      group('presence.confirmed_days', 'p1', 's1', people('i', 6), 58, 60),
      group('presence.confirmed_days', 'p1', 's2', people('j', 6), 59, 60),
      group('presence.unconfirmed_days', 'p1', 's1', people('i', 2), 2, 60),
      group('presence.unconfirmed_days', 'p1', 's2', people('j', 1), 1, 60),
    ];
    const released = releaseAnonymousGroups(groups, K);
    expect(partitionViolations(groups, released, K)).toEqual([]);
  });
});

/**
 * `releaseAnonymousGroups` only ever publishes a cell whose support already
 * clears the threshold, so through that path one sacrifice always covers the
 * residual. `partitionSacrifices` makes no such assumption about its input —
 * it is a pure function over whatever candidates it is handed — so its own
 * contract is pinned here rather than only through its caller.
 */
describe('partitionSacrifices as a unit', () => {
  function candidate(metricKey: OperationsMetricKey, contributors: string[], published: boolean) {
    return { metricKey, contributors: new Set(contributors), published };
  }

  it('keeps sacrificing until the residual clears, not merely once', () => {
    const sacrifices = partitionSacrifices([
      candidate('presence.scheduled_days', people('t', 9), true),
      candidate('presence.confirmed_days', ['t-0', 't-1'], true),
      candidate('presence.vehicle_only_days', ['t-2', 't-3'], true),
      candidate('presence.unconfirmed_days', ['t-4'], false),
    ], K);
    // One sacrifice leaves a residual of three; both are needed to reach five.
    expect(sacrifices).toContain('presence.confirmed_days');
    expect(sacrifices).toContain('presence.vehicle_only_days');
  });

  it('sacrifices nothing when the total cannot be known', () => {
    expect(partitionSacrifices([
      candidate('outcome.confirmed', people('u', 9), false),
      candidate('outcome.duplicate', ['u-0'], false),
    ], K)).toEqual([]);
  });

  it('gives up the total itself when the members cannot cover the residual', () => {
    const sacrifices = partitionSacrifices([
      candidate('presence.scheduled_days', people('v', 9), true),
      candidate('presence.unconfirmed_days', ['v-0'], false),
    ], K);
    expect(sacrifices).toContain('presence.scheduled_days');
  });

  it('gives up a reliability carrier that would publish the incident total', () => {
    const sacrifices = partitionSacrifices([
      candidate('reliability.evidence_available', people('w', 9), true),
      candidate('incident.accident_sos', ['w-0'], false),
    ], K);
    expect(sacrifices).toContain('reliability.evidence_available');
  });
});

describe('the property over randomised configurations', () => {
  /** Deterministic PRNG — a seeded run is reproducible, unlike Math.random. */
  function makeRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  it('never leaves a recoverable residual across 20000 random partitions', () => {
    const random = makeRandom(20260824);
    const members: OperationsMetricKey[] = [
      'presence.confirmed_days', 'presence.unconfirmed_days', 'presence.vehicle_only_days',
    ];
    let checked = 0;
    for (let iteration = 0; iteration < 20_000; iteration += 1) {
      const siteCount = 1 + Math.floor(random() * 3);
      const groups: CalculatedMetricGroup[] = [];
      for (let site = 0; site < siteCount; site += 1) {
        const roster = people(`s${site}`, 1 + Math.floor(random() * 8));
        groups.push(group('presence.scheduled_days', 'p1', `s${site}`, roster, roster.length * 20));
        for (const member of members) {
          const size = Math.floor(random() * (roster.length + 1));
          if (size === 0) continue;
          groups.push(group(member, 'p1', `s${site}`, roster.slice(0, size), size * 3, roster.length * 20));
        }
      }
      const violations = partitionViolations(groups, releaseAnonymousGroups(groups, K), K);
      if (violations.length > 0) {
        throw new Error(`iteration ${iteration}: ${violations.join('; ')}`);
      }
      checked += 1;
    }
    expect(checked).toBe(20_000);
  });
});

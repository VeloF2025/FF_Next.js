/**
 * Which metric keys are arithmetically dependent on which others, and the rule
 * that keeps that dependence from handing back a withheld value.
 *
 * `suppression.ts` protects against differencing WITHIN one metric key: subtract
 * a parent's published children from the parent and you recover the withheld
 * ones, so siblings are withheld until that residual covers enough people. That
 * rule cannot see the other axis. Three families of keys sum to a total which is
 * itself published — as a row of its own for presence, and as the shared
 * denominator carried on every surviving member for outcomes and incidents. So
 * publishing a member's siblings and their total gives the member away by
 * subtraction, and no per-key rule will ever notice.
 *
 * This module is the missing axis. It is pure: no SQL, no clock, no settings
 * lookup, and it decides nothing about levels — the caller applies it at every
 * cell, because differencing works at a site, at a project, and at the
 * organisation alike.
 *
 * See `.claude/modules/fleet-analytics-disclosure.md`, open item 1.
 */
import type { OperationsMetricKey } from './aggregateSchema';
import { INCIDENT_METRIC_KEYS, OUTCOME_METRIC_KEYS } from './aggregateSchema';

/**
 * The two internal denominator tallies, named so they can be reasoned about as
 * variables. They mirror `metricCalculator.ts`'s `INCIDENT_DENOMINATOR` and
 * `OUTCOME_DENOMINATOR` and are deliberately not `OperationsMetricKey`s: no row
 * may ever carry them.
 */
export const INCIDENT_TOTAL_ID = 'incident.total';
export const OUTCOME_TOTAL_ID = 'outcome.reviewed_total';

export interface MetricPartition {
  /**
   * The key that carries the partition's total as a published ROW, when there
   * is one. `null` where the total exists only as the shared denominator on the
   * members (and, for incidents, on `reliability.evidence_available` and
   * `reliability.recurrence`) — it is knowable either way, which is all that
   * matters here.
   */
  totalKey: OperationsMetricKey | null;
  /**
   * The total's name as a VARIABLE, whether or not it is a publishable key.
   * `derivability.ts` needs a handle on the total even where no row can carry
   * it, because a reader who reaches it by arithmetic has it all the same.
   */
  totalId: string;
  /**
   * Whether a surviving member's own row publishes the total, by carrying it as
   * that row's denominator. True for presence and outcomes. FALSE for
   * incidents: `incident.*` rows are counts with no denominator at all, so
   * publishing incident members reveals nothing about `incident.total` and only
   * the two reliability carriers do. Treating them alike over-suppressed every
   * incident partition that had a small member.
   */
  membersCarryTotal: boolean;
  /**
   * Keys outside the partition whose published row also reveals the total,
   * because they carry it as their denominator. Withholding every member is not
   * enough on its own while one of these is still published.
   */
  extraCarriers: readonly OperationsMetricKey[];
  members: readonly OperationsMetricKey[];
}

/**
 * `presence.scheduled_days` is the total, not a member: every scheduled
 * staff-day falls into exactly one of the three, so the members sum to it and
 * their supports union to its support.
 */
export const METRIC_PARTITIONS: readonly MetricPartition[] = [
  {
    totalKey: 'presence.scheduled_days',
    totalId: 'presence.scheduled_days',
    membersCarryTotal: true,
    extraCarriers: [],
    members: ['presence.confirmed_days', 'presence.unconfirmed_days', 'presence.vehicle_only_days'],
  },
  // `outcome.reviewed_total` and `incident.total` are internal denominator
  // tallies, never publishable keys of their own — so the total reaches a reader
  // only through the denominator column, and `totalKey` is null.
  {
    totalKey: null,
    totalId: OUTCOME_TOTAL_ID,
    membersCarryTotal: true,
    extraCarriers: [],
    members: OUTCOME_METRIC_KEYS,
  },
  {
    totalKey: null,
    totalId: INCIDENT_TOTAL_ID,
    // An `incident.*` row is a bare count: `metricCalculator` gives it no
    // denominator, so a published member says nothing about the total.
    membersCarryTotal: false,
    // Both are ratios OVER `incident.total`, so either one publishes the
    // incident partition's total even when no member row survives.
    extraCarriers: ['reliability.evidence_available', 'reliability.recurrence'],
    members: INCIDENT_METRIC_KEYS,
  },
];

/**
 * Nested-subset pairs: one key counts a SUBSET of what another counts, so the
 * pair publishes their difference — a third quantity with a support of its own
 * that no partition above covers, because it has no metric key.
 *
 * `input.requests_sent = input.responses_received + (requests nobody answered)`.
 * Publish both and the complement follows by subtraction. The people it
 * describes are at least those who appear in the superset and not in the
 * subset: they contributed to the superset and contributed nothing to the
 * subset, so every one of their contributions is in the complement. That set
 * difference is what `derivability.ts` uses as the complement's support. It is a
 * LOWER bound — someone present in both may also sit in the complement — and a
 * lower bound is the safe direction for a threshold test.
 */
export interface MetricSubset {
  superset: OperationsMetricKey;
  subset: OperationsMetricKey;
}

export const METRIC_SUBSETS: readonly MetricSubset[] = [
  { superset: 'input.requests_sent', subset: 'input.responses_received' },
  { superset: 'input.requests_sent', subset: 'input.responses_on_time' },
  // On-time responses are a subset of responses, not merely of requests.
  { superset: 'input.responses_received', subset: 'input.responses_on_time' },
  { superset: 'reliability.notifications_sent', subset: 'reliability.notifications_delivered' },
  { superset: 'reliability.monitor_runs_expected', subset: 'reliability.monitor_runs_completed' },
];

/** The complement's variable name for one pair, at one cell. */
export function complementIdOf(subset: MetricSubset): string {
  return `~complement:${subset.superset}-${subset.subset}`;
}

/** Every key whose published row exposes the partition's total. */
export function totalCarriersOf(partition: MetricPartition): readonly OperationsMetricKey[] {
  return partition.totalKey === null ? partition.extraCarriers : [partition.totalKey, ...partition.extraCarriers];
}

export interface PartitionCandidate {
  metricKey: OperationsMetricKey;
  /** The people behind this key in this cell. Empty means nobody contributed. */
  contributors: ReadonlySet<string>;
  published: boolean;
}

/**
 * The additional keys that must be withheld in one cell, given what the per-key
 * rule already decided there.
 *
 * A partition is only at risk once its total is knowable — with no member
 * published and no total row, there is nothing to subtract from. When it is
 * knowable, the withheld members' combined support must either be empty (they
 * are all zero, so the subtraction yields zero and describes nobody) or cover
 * at least `minimumContributors` people.
 *
 * Members are sacrificed smallest-support first, ties broken on the key name, so
 * a re-run over the same month produces the same rows and the same checksum.
 */
export function partitionSacrifices(
  candidates: readonly PartitionCandidate[],
  minimumContributors: number,
): OperationsMetricKey[] {
  const byKey = new Map(candidates.map((candidate) => [candidate.metricKey, candidate]));
  const sacrifices: OperationsMetricKey[] = [];

  for (const partition of METRIC_PARTITIONS) {
    const members = partition.members
      .map((key) => byKey.get(key))
      .filter((candidate): candidate is PartitionCandidate => candidate !== undefined);
    if (members.length === 0) continue;

    const carriers = totalCarriersOf(partition)
      .map((key) => byKey.get(key))
      .filter((candidate): candidate is PartitionCandidate => candidate !== undefined);
    const publishable = members.filter((member) => member.published);
    // A member's row publishes the total only where the member CARRIES it as a
    // denominator. Incident rows do not, so incident members publishing tells a
    // reader nothing to subtract from and the partition is not at risk.
    const totalKnown = (partition.membersCarryTotal && publishable.length > 0)
      || carriers.some((carrier) => carrier.published);
    if (!totalKnown) continue;

    const residual = new Set<string>();
    for (const member of members) {
      if (member.published) continue;
      for (const contributor of member.contributors) residual.add(contributor);
    }
    // Nothing withheld, or everything withheld is zero: no value to recover.
    if (residual.size === 0) continue;

    const queue = [...publishable].sort(
      (a, b) => a.contributors.size - b.contributors.size || a.metricKey.localeCompare(b.metricKey),
    );
    while (residual.size < minimumContributors && queue.length > 0) {
      const sacrificed = queue.shift()!;
      sacrifices.push(sacrificed.metricKey);
      for (const contributor of sacrificed.contributors) residual.add(contributor);
    }

    // Withholding every member still leaves the subtraction workable while the
    // total is published: total − nothing = the whole withheld partition, over
    // fewer than `minimumContributors` people. So the total goes too. This is
    // the disclosure note's "never publish a denominator whose partition has a
    // sub-threshold residual", and it is reachable whenever a partition's
    // members do not between them cover everyone the total counts.
    if (residual.size < minimumContributors) {
      for (const carrier of carriers) {
        if (carrier.published) sacrifices.push(carrier.metricKey);
      }
    }
  }

  return sacrifices;
}

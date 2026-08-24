/**
 * How the metric keys depend on one another — the one place that is written
 * down, and the thing every disclosure decision is made from.
 *
 * `metricCalculator` counts these relations into being: it bumps a denominator
 * tally alongside the metric that divides by it, and an incident's type,
 * outcome, evidence and recurrence all off the same fact. So the tables live
 * here and the calculator imports them, rather than the other way round: a
 * metric cannot be given a denominator without the release rule seeing it.
 *
 * Three kinds of relation, and one derived structure:
 *
 * - **Partitions.** Every unit the total counts falls into exactly one member.
 *   Three of them: presence by confirmation, incidents by type, reviewed
 *   incidents by outcome.
 * - **Subsets.** One key counts a subset of another, and the DIFFERENCE is a
 *   real quantity with people behind it and no metric key of its own — requests
 *   nobody answered, notifications that failed, incidents nobody reviewed. Most
 *   fall out of the denominator table, because that is what a denominator IS;
 *   two do not and are named.
 * - **Rests.** The complement of each subset pair, as an internal tally key.
 *   `metricCalculator` counts their support exactly, from the same fact that
 *   counts the pair. Nothing here is a bound.
 * - **Components.** The connected pieces of all that. Presence is one. Incidents,
 *   their outcomes and the two reliability ratios over `incident.total` are one.
 *   Driver input is one. Each remaining reliability pair is one, and each timing
 *   key is a component by itself. Two variables in DIFFERENT components have no
 *   arithmetic between them at all, which is what lets the release rule decide
 *   one component at a time.
 */
import {
  INCIDENT_METRIC_KEYS, OPERATIONS_METRIC_KEYS, OUTCOME_METRIC_KEYS, PRESENCE_METRIC_KEYS,
} from './aggregateSchema';
import type { OperationsMetricKey } from './aggregateSchema';

/**
 * Counted only to serve as denominators. Neither is a publishable metric key,
 * so neither is ever emitted as a row — which is why a component rooted on one
 * of them has nothing to publish short of the whole component.
 */
export const INCIDENT_TOTAL = 'incident.total';
export const OUTCOME_TOTAL = 'outcome.reviewed_total';

/**
 * The population each ratio divides by, as an internal tally key. A metric
 * absent from this map is a count, and is published with no denominator.
 */
export const DENOMINATOR_OF: Partial<Record<OperationsMetricKey, string>> = {
  'presence.confirmed_days': 'presence.scheduled_days',
  'presence.unconfirmed_days': 'presence.scheduled_days',
  'presence.vehicle_only_days': 'presence.scheduled_days',
  'input.responses_received': 'input.requests_sent',
  'input.responses_on_time': 'input.requests_sent',
  'reliability.monitor_runs_completed': 'reliability.monitor_runs_expected',
  'reliability.notifications_delivered': 'reliability.notifications_sent',
  'reliability.evidence_available': INCIDENT_TOTAL,
  'reliability.recurrence': INCIDENT_TOTAL,
};

export function denominatorKeyFor(metricKey: OperationsMetricKey): string | null {
  if (metricKey.startsWith('outcome.')) return OUTCOME_TOTAL;
  return DENOMINATOR_OF[metricKey] ?? null;
}

export interface MetricPartition {
  total: string;
  members: readonly OperationsMetricKey[];
}

export const METRIC_PARTITIONS: readonly MetricPartition[] = [
  {
    total: 'presence.scheduled_days',
    members: PRESENCE_METRIC_KEYS.filter((key) => key !== 'presence.scheduled_days'),
  },
  { total: OUTCOME_TOTAL, members: OUTCOME_METRIC_KEYS },
  { total: INCIDENT_TOTAL, members: INCIDENT_METRIC_KEYS },
];

export interface MetricSubset {
  whole: string;
  part: string;
}

/**
 * Nesting pairs whose difference has no metric key. Derived from the
 * denominator table, minus the pairs a partition already covers exhaustively —
 * where the part is a MEMBER of its denominator's partition the difference is
 * the sum of the other members and needs no tally of its own — plus the two
 * nestings no denominator column records.
 *
 * Being a ratio over a partition's total does not make a key a member of it.
 * `reliability.evidence_available` divides by `incident.total` and is nothing's
 * member, so the incidents WITHOUT evidence are a complement in their own right.
 */
export const METRIC_SUBSETS: readonly MetricSubset[] = (() => {
  const pairs: MetricSubset[] = [];
  for (const metricKey of OPERATIONS_METRIC_KEYS) {
    const whole = denominatorKeyFor(metricKey);
    if (whole === null) continue;
    const partition = METRIC_PARTITIONS.find((candidate) => candidate.total === whole);
    if (partition?.members.some((member) => member === metricKey)) continue;
    pairs.push({ whole, part: metricKey });
  }
  // `applyIncident` bumps `outcome.reviewed_total` only where an incident HAS an
  // outcome; the difference is the incidents nobody reviewed. And an on-time
  // response is a response, not merely a request.
  pairs.push({ whole: INCIDENT_TOTAL, part: OUTCOME_TOTAL });
  pairs.push({ whole: 'input.responses_received', part: 'input.responses_on_time' });
  return pairs.sort((a, b) => a.whole.localeCompare(b.whole) || a.part.localeCompare(b.part));
})();

/** Marks an internal tally as the complement of a subset pair, never a row. */
export const REST_PREFIX = '~rest:';

export const restIdOf = (subset: MetricSubset): string =>
  `${REST_PREFIX}${subset.whole}-${subset.part}`;

export interface MetricComponent {
  /** The one variable in the component that is nothing else's member or part. */
  root: string;
  /** The root as a publishable row, where there is one. `incident.total` is not. */
  rootKey: OperationsMetricKey | null;
  /** Every publishable row in the component. */
  keys: readonly OperationsMetricKey[];
  /** Every variable whose support the FULL tier tests, rests included. */
  variables: readonly string[];
  partitions: readonly MetricPartition[];
  subsets: readonly MetricSubset[];
}

export const METRIC_COMPONENTS: readonly MetricComponent[] = (() => {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (a: string, b: string): void => { parent.set(find(a), find(b)); };

  for (const key of OPERATIONS_METRIC_KEYS) find(key);
  find(INCIDENT_TOTAL);
  find(OUTCOME_TOTAL);
  for (const partition of METRIC_PARTITIONS) {
    for (const member of partition.members) union(member, partition.total);
  }
  for (const subset of METRIC_SUBSETS) union(subset.part, subset.whole);

  const derived = new Set(
    [...METRIC_PARTITIONS.flatMap((partition) => partition.members), ...METRIC_SUBSETS.map((s) => s.part)],
  );

  const grouped = new Map<string, string[]>();
  for (const id of [...OPERATIONS_METRIC_KEYS, INCIDENT_TOTAL, OUTCOME_TOTAL]) {
    grouped.set(find(id), [...(grouped.get(find(id)) ?? []), id]);
  }

  const publishable = new Set<string>(OPERATIONS_METRIC_KEYS);
  return [...grouped.values()].map((members) => {
    const roots = members.filter((id) => !derived.has(id));
    if (roots.length !== 1) {
      throw new Error(`fleet metric relations: component ${members.join(',')} has ${roots.length} roots`);
    }
    const root = roots[0]!;
    const inside = new Set(members);
    const partitions = METRIC_PARTITIONS.filter((partition) => inside.has(partition.total));
    const subsets = METRIC_SUBSETS.filter((subset) => inside.has(subset.whole));
    return {
      root,
      rootKey: publishable.has(root) ? (root as OperationsMetricKey) : null,
      keys: members.filter((id): id is OperationsMetricKey => publishable.has(id)).sort(),
      variables: [...members, ...subsets.map(restIdOf)].sort(),
      partitions,
      subsets,
    };
  }).sort((a, b) => a.root.localeCompare(b.root));
})();

/** The component a metric key belongs to. Every key is in exactly one. */
export const COMPONENT_OF: ReadonlyMap<OperationsMetricKey, MetricComponent> = new Map(
  METRIC_COMPONENTS.flatMap((component) => component.keys.map((key) => [key, component] as const)),
);

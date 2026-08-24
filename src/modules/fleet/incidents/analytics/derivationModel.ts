/**
 * The reader's variables and the relations between them — the MODEL only.
 *
 * Split from `derivability.ts` so the arithmetic that answers "what is
 * recoverable?" stays separate from the declaration of what a reader is
 * subtracting from what. Everything here is bookkeeping: name the variables,
 * work out who is behind each of them, decide which start out known, and write
 * down the identities.
 *
 * ## What a reader holds without doing any arithmetic
 *
 * 1. **A published row's own value.**
 * 2. **A published row's DENOMINATOR.** This is the one that keeps being
 *    forgotten. `input.requests_sent` can be withheld from the cube and still be
 *    printed, in full, in the denominator column of the `input.responses_received`
 *    row that survived beside it. The carrier map is therefore DERIVED from
 *    `metricCalculator`'s `DENOMINATOR_OF` (`DENOMINATOR_CARRIERS`) rather than
 *    restated here — a metric given a denominator there cannot acquire one
 *    without this rule seeing it.
 * 3. **A zero.** A variable with nobody behind it has value zero: an absent key,
 *    an empty partition total, a complement whose two sides share every
 *    contributor. Assuming the reader knows a zero is a zero can only make more
 *    derivable, never less, which is the safe direction.
 */
import { OPERATIONS_METRIC_KEYS } from './aggregateSchema';
import type { OperationsMetricKey } from './aggregateSchema';
import { DENOMINATOR_CARRIERS } from './metricCalculator';
import type { MetricSubset } from './metricPartitions';
import { METRIC_PARTITIONS, METRIC_SUBSETS, complementIdOf } from './metricPartitions';

/** One metric value at one cell, as suppression currently intends to release it. */
export interface DerivationValue {
  /** Identity of the (month, version, level, project, site) scope. */
  cellId: string;
  /** The scope one level up, or null at the organisation. */
  parentCellId: string | null;
  metricKey: OperationsMetricKey;
  contributors: ReadonlySet<string>;
  published: boolean;
}

export interface Variable {
  support: Set<string>;
  known: boolean;
  /** Published value ids the knownness rests on. Empty for a free zero. */
  anchors: Set<string>;
}

export interface Relation {
  /** The total first, then its parts: `variables[0] = sum(variables[1..])`. */
  variables: readonly string[];
}

export const valueIdOf = (cellId: string, key: string): string => `${cellId}#${key}`;

/** Every variable name a relation can mention. */
export const RELATION_VARIABLE_IDS: readonly string[] = (() => {
  const ids = new Set<string>();
  for (const partition of METRIC_PARTITIONS) {
    ids.add(partition.totalId);
    for (const member of partition.members) ids.add(member);
  }
  for (const subset of METRIC_SUBSETS) {
    ids.add(subset.superset);
    ids.add(subset.subset);
    ids.add(complementIdOf(subset));
  }
  return [...ids].sort();
})();

/**
 * Who is behind `superset - subset`.
 *
 * Where the superset is an EXHAUSTIVE sum and the subset is one of its members,
 * the complement is the sum of the other members and its people are exactly
 * their union. That is worth finding, because the general answer is only a
 * bound: contributors in the superset and not the subset must be in the
 * complement, but somebody present in both may be there too. The bound is safe —
 * it can only understate the group, and understating it can only over-suppress —
 * yet understating it badly over-suppresses badly. `presence.scheduled_days`
 * minus `presence.unconfirmed_days` is the whole confirmed and vehicle-only
 * population; the set difference calls it one person.
 */
function complementSupport(
  supports: ReadonlyMap<string, Set<string>>, subset: MetricSubset,
): Set<string> {
  const exhaustive = METRIC_PARTITIONS.find(
    (partition) => partition.totalId === subset.superset
      && partition.members.some((member) => member === subset.subset),
  );
  const people = new Set<string>();
  if (exhaustive) {
    for (const member of exhaustive.members) {
      if (member === subset.subset) continue;
      for (const person of supports.get(member) ?? []) people.add(person);
    }
    return people;
  }
  const inside = supports.get(subset.subset) ?? new Set<string>();
  for (const person of supports.get(subset.superset) ?? []) {
    if (!inside.has(person)) people.add(person);
  }
  return people;
}

/**
 * Who is behind each variable at one cell.
 *
 * Order matters: a partition total's support is the union of its members', and a
 * complement's is a difference of two supports either of which may itself be a
 * partition total. Implicit totals are therefore resolved before complements.
 */
function supportsAt(
  values: ReadonlyMap<string, DerivationValue>, cellId: string,
): Map<string, Set<string>> {
  const supports = new Map<string, Set<string>>();
  for (const key of OPERATIONS_METRIC_KEYS) {
    const value = values.get(valueIdOf(cellId, key));
    if (value) supports.set(key, new Set(value.contributors));
  }
  for (const partition of METRIC_PARTITIONS) {
    if (supports.has(partition.totalId)) continue;
    const union = new Set<string>();
    for (const member of partition.members) {
      for (const person of supports.get(member) ?? []) union.add(person);
    }
    supports.set(partition.totalId, union);
  }
  for (const subset of METRIC_SUBSETS) {
    supports.set(complementIdOf(subset), complementSupport(supports, subset));
  }
  return supports;
}

export function buildVariables(
  values: ReadonlyMap<string, DerivationValue>, cellIds: readonly string[],
): Map<string, Variable> {
  const variables = new Map<string, Variable>();
  for (const cellId of cellIds) {
    const supports = supportsAt(values, cellId);
    for (const id of RELATION_VARIABLE_IDS) {
      const anchors = new Set<string>();
      if (values.get(valueIdOf(cellId, id))?.published) anchors.add(valueIdOf(cellId, id));
      for (const carrier of DENOMINATOR_CARRIERS.get(id) ?? []) {
        if (values.get(valueIdOf(cellId, carrier))?.published) anchors.add(valueIdOf(cellId, carrier));
      }
      const support = supports.get(id) ?? new Set<string>();
      variables.set(valueIdOf(cellId, id), {
        support, anchors, known: anchors.size > 0 || support.size === 0,
      });
    }
  }
  return variables;
}

export function buildRelations(
  cellIds: readonly string[], parents: ReadonlyMap<string, string | null>,
): Relation[] {
  const relations: Relation[] = [];
  for (const cellId of cellIds) {
    for (const partition of METRIC_PARTITIONS) {
      relations.push({
        variables: [
          valueIdOf(cellId, partition.totalId),
          ...partition.members.map((member) => valueIdOf(cellId, member)),
        ],
      });
    }
    for (const subset of METRIC_SUBSETS) {
      relations.push({
        variables: [
          valueIdOf(cellId, subset.superset),
          valueIdOf(cellId, subset.subset),
          valueIdOf(cellId, complementIdOf(subset)),
        ],
      });
    }
  }

  const children = new Map<string, string[]>();
  for (const cellId of cellIds) {
    const parent = parents.get(cellId);
    if (!parent) continue;
    children.set(parent, [...(children.get(parent) ?? []), cellId]);
  }
  for (const [parent, kids] of children) {
    for (const key of RELATION_VARIABLE_IDS) {
      relations.push({ variables: [valueIdOf(parent, key), ...kids.map((kid) => valueIdOf(kid, key))] });
    }
  }
  return relations;
}

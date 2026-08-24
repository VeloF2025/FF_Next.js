/**
 * The reader's variables and the relations between them — the MODEL only.
 *
 * Split from `derivability.ts` so the arithmetic that answers "what is
 * recoverable?" stays separate from the declaration of what a reader is
 * subtracting from what. Everything here is bookkeeping over
 * `metricPartitions.ts`: name the variables, work out who is behind each of
 * them, decide which start out known, and write down the identities.
 *
 * Three things become known without any arithmetic: a published row states its
 * own value; a published row carrying a partition's total as its denominator
 * states that total; and a variable with nobody behind it is zero. The third is
 * the conservative reading — assuming the reader knows a zero is a zero can only
 * make more derivable, never less.
 */
import type { OperationsMetricKey } from './aggregateSchema';
import type { MetricSubset } from './metricPartitions';
import { METRIC_PARTITIONS, METRIC_SUBSETS, complementIdOf, totalCarriersOf } from './metricPartitions';

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
  /** The total first, then its members: `variables[0] = sum(variables[1..])`. */
  variables: readonly string[];
}

export const valueIdOf = (cellId: string, key: string): string => `${cellId}#${key}`;

/** Every variable name a relation can mention, beyond the plain metric keys. */
function relationVariableIds(): string[] {
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
}

const RELATION_VARIABLE_IDS = relationVariableIds();

function supportOfKey(
  values: ReadonlyMap<string, DerivationValue>, cellId: string, key: OperationsMetricKey,
): ReadonlySet<string> {
  return values.get(valueIdOf(cellId, key))?.contributors ?? new Set<string>();
}

/** superset minus subset: people who contributed to the one and not the other. */
function complementSupport(
  values: ReadonlyMap<string, DerivationValue>, cellId: string, subset: MetricSubset,
): Set<string> {
  const inSubset = supportOfKey(values, cellId, subset.subset);
  const residual = new Set<string>();
  for (const person of supportOfKey(values, cellId, subset.superset)) {
    if (!inSubset.has(person)) residual.add(person);
  }
  return residual;
}

export function buildVariables(
  values: ReadonlyMap<string, DerivationValue>, cellIds: readonly string[],
): Map<string, Variable> {
  const variables = new Map<string, Variable>();
  const put = (id: string, support: Set<string>, known: boolean, anchors: Set<string>): void => {
    variables.set(id, { support, known, anchors });
  };

  for (const cellId of cellIds) {
    for (const key of RELATION_VARIABLE_IDS) {
      const value = values.get(valueIdOf(cellId, key));
      if (!value) continue;
      put(
        valueIdOf(cellId, key), new Set(value.contributors), value.published,
        value.published ? new Set([valueIdOf(cellId, key)]) : new Set(),
      );
    }
    for (const partition of METRIC_PARTITIONS) {
      const total = new Set<string>();
      for (const member of partition.members) {
        for (const person of supportOfKey(values, cellId, member)) total.add(person);
      }
      const carrierKeys = partition.membersCarryTotal
        ? [...totalCarriersOf(partition), ...partition.members]
        : totalCarriersOf(partition);
      const anchors = new Set<string>();
      for (const carrier of carrierKeys) {
        if (values.get(valueIdOf(cellId, carrier))?.published) anchors.add(valueIdOf(cellId, carrier));
      }
      const totalId = valueIdOf(cellId, partition.totalId);
      // A real total key already has a variable from the loop above; a published
      // member only ever ADDS a way of knowing it, never removes one.
      const existing = variables.get(totalId);
      if (existing) {
        for (const anchor of anchors) existing.anchors.add(anchor);
        existing.known = existing.known || anchors.size > 0;
      } else if (partition.totalKey !== null) {
        // A publishable total with no data here is zero, and free to know.
        put(totalId, new Set(), true, new Set());
      } else {
        put(totalId, total, anchors.size > 0, anchors);
      }
    }
    for (const subset of METRIC_SUBSETS) {
      put(valueIdOf(cellId, complementIdOf(subset)), complementSupport(values, cellId, subset), false, new Set());
    }
  }

  // Nobody behind a variable means its value is zero — an absent key, or a
  // complement whose two sides share every contributor. Free to know, and
  // knowing it can only make MORE derivable, which is the safe direction.
  for (const variable of variables.values()) {
    if (variable.support.size === 0) variable.known = true;
  }
  return variables;
}

export function buildRelations(cellIds: readonly string[], parents: ReadonlyMap<string, string | null>): Relation[] {
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

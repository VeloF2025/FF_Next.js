/**
 * The oracle's OWN picture of what a reader is subtracting from what.
 *
 * Rebuilt from `metricCalculator`'s denominator table and the schema's key
 * lists. It never imports `metricPartitions.ts`, and that is the entire point:
 * two of the five findings against this module were MISSING relations, and an
 * oracle importing the model it audits cannot notice one.
 */
import {
  INCIDENT_METRIC_KEYS, OPERATIONS_METRIC_KEYS, OUTCOME_METRIC_KEYS, PRESENCE_METRIC_KEYS,
} from '../aggregateSchema';
import type { CalculatedMetricGroup } from '../facts';
import {
  DENOMINATOR_CARRIERS, INCIDENT_DENOMINATOR, OUTCOME_DENOMINATOR,
} from '../metricCalculator';
import type { ReleasedAggregate } from '../suppression';

export const SUM_TOTAL = 0;
export const PRESENCE_TOTAL = 'presence.scheduled_days';

/**
 * Exhaustive sums: every unit the total counts falls into exactly one part.
 * Declared from the schema's key lists, which is where the exhaustiveness lives
 * — a scheduled day is confirmed, unconfirmed or vehicle-only and nothing else.
 */
export const SUMS: readonly { total: string; parts: readonly string[] }[] = [
  { total: PRESENCE_TOTAL, parts: PRESENCE_METRIC_KEYS.filter((key) => key !== PRESENCE_TOTAL) },
  { total: OUTCOME_DENOMINATOR, parts: OUTCOME_METRIC_KEYS },
  { total: INCIDENT_DENOMINATOR, parts: INCIDENT_METRIC_KEYS },
];

/** Nestings: a ratio counts a subset of its own denominator, plus two more. */
export const NESTINGS: readonly { whole: string; part: string }[] = (() => {
  const pairs: { whole: string; part: string }[] = [];
  for (const [population, carriers] of DENOMINATOR_CARRIERS) {
    for (const carrier of carriers) pairs.push({ whole: population, part: carrier });
  }
  pairs.push({ whole: 'input.responses_received', part: 'input.responses_on_time' });
  pairs.push({ whole: INCIDENT_DENOMINATOR, part: OUTCOME_DENOMINATOR });
  return pairs;
})();

export const restOf = (nesting: { whole: string; part: string }): string =>
  `@rest:${nesting.whole}-${nesting.part}`;

export const VARIABLE_NAMES: readonly string[] = [...new Set([
  ...SUMS.flatMap((sum) => [sum.total, ...sum.parts]),
  ...NESTINGS.flatMap((nesting) => [nesting.whole, nesting.part, restOf(nesting)]),
])].sort();

export const at = (cell: string, name: string): string => `${cell}#${name}`;

export interface Cube {
  cells: string[];
  parentOf: Map<string, string | null>;
  support: Map<string, Set<string>>;
  /** Variables a published row states outright, itself or as its denominator. */
  stated: Set<string>;
}

export function buildCube(groups: readonly CalculatedMetricGroup[], released: readonly ReleasedAggregate[]): Cube {
  const parentOf = new Map<string, string | null>();
  const support = new Map<string, Set<string>>();
  const grow = (id: string, people: Iterable<string>): void => {
    const bucket = support.get(id) ?? new Set<string>();
    for (const person of people) bucket.add(person);
    support.set(id, bucket);
  };

  for (const group of groups) {
    const stem = `${group.monthStart}|${group.metricVersion}`;
    const site = `${stem}|site|${group.projectId}|${group.operationalSiteId}`;
    const project = `${stem}|project|${group.projectId}|`;
    const organisation = `${stem}|organisation||`;
    parentOf.set(site, project);
    parentOf.set(project, organisation);
    parentOf.set(organisation, null);
    for (const cell of [site, project, organisation]) grow(at(cell, group.metricKey), group.contributors);
  }

  const cells = [...parentOf.keys()].sort();
  for (const cell of cells) {
    for (const sum of SUMS) {
      if (support.has(at(cell, sum.total))) continue;
      for (const part of sum.parts) grow(at(cell, sum.total), support.get(at(cell, part)) ?? []);
    }
  }
  for (const cell of cells) {
    for (const nesting of NESTINGS) {
      // Where the whole is an exhaustive sum and the part is one of its parts,
      // the rest IS the other parts and its people are exactly their union.
      // Everywhere else only a bound is available: whoever is in the whole and
      // not the part. The bound understates, which over-suppresses rather than
      // under-protects, but it understates badly enough to be worth avoiding
      // wherever the exact answer is sitting right there.
      const sum = SUMS.find(
        (candidate) => candidate.total === nesting.whole && candidate.parts.includes(nesting.part),
      );
      const rest = new Set<string>();
      if (sum) {
        for (const part of sum.parts) {
          if (part === nesting.part) continue;
          for (const person of support.get(at(cell, part)) ?? []) rest.add(person);
        }
      } else {
        const inside = support.get(at(cell, nesting.part)) ?? new Set<string>();
        for (const person of support.get(at(cell, nesting.whole)) ?? []) {
          if (!inside.has(person)) rest.add(person);
        }
      }
      support.set(at(cell, restOf(nesting)), rest);
    }
  }

  const published = new Set<string>();
  for (const row of released) {
    const cell = `${row.monthStart}|${row.metricVersion}|${row.dimensionLevel}|${row.dimensionProjectId ?? ''}|${row.dimensionSiteId ?? ''}`;
    published.add(at(cell, row.metricKey));
  }
  // A published row states its denominator as plainly as its numerator.
  const stated = new Set(published);
  for (const cell of cells) {
    for (const metricKey of OPERATIONS_METRIC_KEYS) {
      if (!published.has(at(cell, metricKey))) continue;
      for (const [population, carriers] of DENOMINATOR_CARRIERS) {
        if (carriers.includes(metricKey)) stated.add(at(cell, population));
      }
    }
  }

  return { cells, parentOf, support, stated };
}

export function relationsOf(cube: Cube): string[][] {
  const relations: string[][] = [];
  for (const cell of cube.cells) {
    for (const sum of SUMS) relations.push([at(cell, sum.total), ...sum.parts.map((part) => at(cell, part))]);
    for (const nesting of NESTINGS) {
      relations.push([at(cell, nesting.whole), at(cell, nesting.part), at(cell, restOf(nesting))]);
    }
  }
  const kids = new Map<string, string[]>();
  for (const [cell, parent] of cube.parentOf) {
    if (parent) kids.set(parent, [...(kids.get(parent) ?? []), cell]);
  }
  for (const [parent, children] of kids) {
    for (const name of VARIABLE_NAMES) {
      relations.push([at(parent, name), ...children.map((child) => at(child, name))]);
    }
  }
  return relations;
}

/**
 * The oracle's OWN picture of what a reader is subtracting from what, and the
 * supports behind every variable.
 *
 * Rebuilt from `DENOMINATOR_OF` and the schema's key lists. It does not import
 * `metricRelations`' partitions, subsets or components: two findings against the
 * previous design were MISSING relations, and an oracle importing the model it
 * audits cannot notice one.
 */
import {
  INCIDENT_METRIC_KEYS, OPERATIONS_METRIC_KEYS, OUTCOME_METRIC_KEYS, PRESENCE_METRIC_KEYS,
} from '../aggregateSchema';
import type { OperationsMetricKey } from '../aggregateSchema';
import type { CalculatedSiteMonth } from '../metricCalculator';
import { DENOMINATOR_OF } from '../metricRelations';
import type { ReleasedAggregate } from '../suppression';

export const INCIDENT_TOTAL = 'incident.total';
export const OUTCOME_TOTAL = 'outcome.reviewed_total';

export const SUMS: readonly { total: string; parts: readonly string[] }[] = [
  {
    total: 'presence.scheduled_days',
    parts: PRESENCE_METRIC_KEYS.filter((key) => key !== 'presence.scheduled_days'),
  },
  { total: OUTCOME_TOTAL, parts: OUTCOME_METRIC_KEYS },
  { total: INCIDENT_TOTAL, parts: INCIDENT_METRIC_KEYS },
];

export const denominatorOf = (metricKey: OperationsMetricKey): string | null =>
  (metricKey.startsWith('outcome.') ? OUTCOME_TOTAL : DENOMINATOR_OF[metricKey] ?? null);

export const NESTINGS: readonly { whole: string; part: string }[] = (() => {
  const pairs: { whole: string; part: string }[] = [];
  for (const metricKey of OPERATIONS_METRIC_KEYS) {
    const whole = denominatorOf(metricKey);
    if (whole === null) continue;
    if (SUMS.some((sum) => sum.total === whole && sum.parts.includes(metricKey))) continue;
    pairs.push({ whole, part: metricKey });
  }
  pairs.push({ whole: INCIDENT_TOTAL, part: OUTCOME_TOTAL });
  pairs.push({ whole: 'input.responses_received', part: 'input.responses_on_time' });
  return pairs;
})();

export const restOf = (nesting: { whole: string; part: string }): string => `@rest:${nesting.whole}-${nesting.part}`;

export const NAMES: readonly string[] = [...new Set([
  ...SUMS.flatMap((sum) => [sum.total, ...sum.parts]),
  ...NESTINGS.flatMap((nesting) => [nesting.whole, nesting.part, restOf(nesting)]),
  ...OPERATIONS_METRIC_KEYS,
])].sort();

export const at = (cell: string, name: string): string => `${cell}#${name}`;

export interface Cube {
  cells: string[];
  parentOf: Map<string, string | null>;
  support: Map<string, Set<string>>;
  published: Set<string>;
}

/**
 * Supports for every variable at every cell, taken from the calculator: metric
 * keys and internal tallies as counted, rolled up by union.
 */
export function buildCube(siteMonths: readonly CalculatedSiteMonth[], released: readonly ReleasedAggregate[]): Cube {
  const parentOf = new Map<string, string | null>();
  const support = new Map<string, Set<string>>();
  const grow = (id: string, people: Iterable<string>): void => {
    const bucket = support.get(id) ?? new Set<string>();
    for (const person of people) bucket.add(person);
    support.set(id, bucket);
  };

  for (const siteMonth of siteMonths) {
    const stem = `${siteMonth.monthStart}|${siteMonth.metricVersion}`;
    const site = `${stem}|site|${siteMonth.projectId}|${siteMonth.operationalSiteId}`;
    const project = `${stem}|project|${siteMonth.projectId}|`;
    const organisation = `${stem}|organisation||`;
    parentOf.set(site, project);
    parentOf.set(project, organisation);
    parentOf.set(organisation, null);
    for (const cell of [site, project, organisation]) {
      for (const group of siteMonth.groups) grow(at(cell, group.metricKey), group.contributors);
      for (const [variable, people] of siteMonth.internalSupport) {
        grow(at(cell, variable.replace('~rest:', '@rest:')), people);
      }
    }
  }

  const published = new Set<string>();
  for (const row of released) {
    const cell = `${row.monthStart}|${row.metricVersion}|${row.dimensionLevel}|${row.dimensionProjectId ?? ''}|${row.dimensionSiteId ?? ''}`;
    published.add(at(cell, row.metricKey));
    // A published row states its denominator as plainly as its numerator.
    const whole = row.denominator === null ? null : denominatorOf(row.metricKey);
    if (whole !== null) published.add(at(cell, whole));
  }

  return { cells: [...parentOf.keys()].sort(), parentOf, support, published };
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
    for (const name of NAMES) relations.push([at(parent, name), ...children.map((child) => at(child, name))]);
  }
  return relations;
}

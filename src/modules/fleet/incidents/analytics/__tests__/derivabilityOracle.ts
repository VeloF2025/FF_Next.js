/**
 * An INDEPENDENT answer to "what can a reader work out from these rows?".
 *
 * `suppression.ts` reaches its answer by repeatedly handing over the last
 * unknown in a relation. A test that did the same thing would only prove the
 * copy agrees with the original, so this file does not do the same thing: it
 * writes the reader's whole system down as a matrix and row-reduces it exactly.
 * A value is recoverable if and only if its unit vector lies in the row space —
 * which is the definition, not an algorithm borrowed from the code under test,
 * and is strictly stronger than one-unknown-at-a-time propagation.
 *
 * The relation table below is also declared here rather than imported. That is
 * the point of the exercise: the second blocking finding on PR #2604 was a
 * MISSING relation, and an oracle importing the model it is meant to audit
 * cannot notice one.
 *
 * Reported as violations:
 *
 * - a reduced row that is a unit vector — one withheld value handed over whole —
 *   whose support is between 1 and k-1;
 * - any reduced row at all whose unknowns describe between 1 and k-1 people, the
 *   older residual property, now checked over the reduced combinations rather
 *   than over the relations as written.
 *
 * Only relations anchored on a published ROW are admitted. A relation known
 * solely through withheld variables states an identity among unknowns and hands
 * over no number; one known solely through ABSENT keys hands over a zero that
 * was never withheld. Counting either would report a leak where the reader has
 * nothing, and neither could be repaired by publishing less.
 */
import {
  INCIDENT_METRIC_KEYS, OUTCOME_METRIC_KEYS,
} from '../aggregateSchema';
import type { OperationsMetricKey } from '../aggregateSchema';
import type { CalculatedMetricGroup } from '../facts';
import type { ReleasedAggregate } from '../suppression';

interface SumPartition {
  total: string;
  members: readonly OperationsMetricKey[];
  /** Whether a published member's own row states the total, as its denominator. */
  membersCarryTotal: boolean;
  carriers: readonly OperationsMetricKey[];
}

const SUM_PARTITIONS: readonly SumPartition[] = [
  {
    total: 'presence.scheduled_days',
    members: ['presence.confirmed_days', 'presence.unconfirmed_days', 'presence.vehicle_only_days'],
    membersCarryTotal: true,
    carriers: [],
  },
  { total: '@outcome.reviewed_total', members: OUTCOME_METRIC_KEYS, membersCarryTotal: true, carriers: [] },
  {
    total: '@incident.total',
    members: INCIDENT_METRIC_KEYS,
    membersCarryTotal: false,
    carriers: ['reliability.evidence_available', 'reliability.recurrence'],
  },
];

const SUBSET_PAIRS: readonly { superset: OperationsMetricKey; subset: OperationsMetricKey }[] = [
  { superset: 'input.requests_sent', subset: 'input.responses_received' },
  { superset: 'input.requests_sent', subset: 'input.responses_on_time' },
  { superset: 'input.responses_received', subset: 'input.responses_on_time' },
  { superset: 'reliability.notifications_sent', subset: 'reliability.notifications_delivered' },
  { superset: 'reliability.monitor_runs_expected', subset: 'reliability.monitor_runs_completed' },
];

const complementOf = (pair: { superset: string; subset: string }): string =>
  `@complement:${pair.superset}-${pair.subset}`;

const at = (cell: string, key: string): string => `${cell}#${key}`;

interface Cube {
  cells: string[];
  parentOf: Map<string, string | null>;
  /** People behind each (cell, variable). Absent means no data: the value is 0. */
  support: Map<string, Set<string>>;
  /** (cell, metric key) pairs a released row states outright. */
  published: Set<string>;
}

function buildCube(groups: readonly CalculatedMetricGroup[], released: readonly ReleasedAggregate[]): Cube {
  const parentOf = new Map<string, string | null>();
  const support = new Map<string, Set<string>>();
  const add = (cell: string, key: string, people: Iterable<string>): void => {
    const bucket = support.get(at(cell, key)) ?? new Set<string>();
    for (const person of people) bucket.add(person);
    support.set(at(cell, key), bucket);
  };

  for (const group of groups) {
    const stem = `${group.monthStart}|${group.metricVersion}`;
    const site = `${stem}|site|${group.projectId}|${group.operationalSiteId}`;
    const project = `${stem}|project|${group.projectId}|`;
    const organisation = `${stem}|organisation||`;
    parentOf.set(site, project);
    parentOf.set(project, organisation);
    parentOf.set(organisation, null);
    for (const cell of [site, project, organisation]) add(cell, group.metricKey, group.contributors);
  }

  // Derived variables: a partition's total is whoever any member counts; a
  // subset pair's complement is whoever the superset counts and the subset
  // does not.
  for (const cell of parentOf.keys()) {
    for (const partition of SUM_PARTITIONS) {
      if (!partition.total.startsWith('@')) continue;
      const people = new Set<string>();
      for (const member of partition.members) {
        for (const person of support.get(at(cell, member)) ?? []) people.add(person);
      }
      if (people.size > 0) support.set(at(cell, partition.total), people);
    }
    for (const pair of SUBSET_PAIRS) {
      const inSubset = support.get(at(cell, pair.subset)) ?? new Set<string>();
      const people = new Set<string>();
      for (const person of support.get(at(cell, pair.superset)) ?? []) {
        if (!inSubset.has(person)) people.add(person);
      }
      if (people.size > 0) support.set(at(cell, complementOf(pair)), people);
    }
  }

  const published = new Set<string>();
  for (const row of released) {
    const cell = `${row.monthStart}|${row.metricVersion}|${row.dimensionLevel}|${row.dimensionProjectId ?? ''}|${row.dimensionSiteId ?? ''}`;
    published.add(at(cell, row.metricKey));
  }

  return { cells: [...parentOf.keys()].sort(), parentOf, support, published };
}

/** Whether the reader holds this variable's value without any arithmetic. */
function statedOutright(cube: Cube, cell: string, variable: string): boolean {
  // Nobody behind a variable means its value is zero, whatever its shape: an
  // absent key, an empty partition total, a complement whose two sides share
  // every contributor. The reader may assume all three.
  if ((cube.support.get(at(cell, variable))?.size ?? 0) === 0) return true;
  if (variable.startsWith('@complement:')) return false;
  if (!variable.startsWith('@')) return cube.published.has(at(cell, variable));
  const partition = SUM_PARTITIONS.find((candidate) => candidate.total === variable)!;
  const carriers = partition.membersCarryTotal
    ? [...partition.carriers, ...partition.members]
    : partition.carriers;
  return carriers.some((carrier) => cube.published.has(at(cell, carrier)));
}

/** Whether a published row states this variable, directly or as its denominator. */
function backedByRow(cube: Cube, id: string): boolean {
  const [cell, variable] = [id.slice(0, id.lastIndexOf('#')), id.slice(id.lastIndexOf('#') + 1)];
  if (variable.startsWith('@complement:')) return false;
  if (!variable.startsWith('@')) return cube.published.has(at(cell, variable));
  const partition = SUM_PARTITIONS.find((candidate) => candidate.total === variable)!;
  const carriers = partition.membersCarryTotal
    ? [...partition.carriers, ...partition.members]
    : partition.carriers;
  return carriers.some((carrier) => cube.published.has(at(cell, carrier)));
}

function relationsOf(cube: Cube): string[][] {
  const relations: string[][] = [];
  for (const cell of cube.cells) {
    for (const partition of SUM_PARTITIONS) {
      relations.push([at(cell, partition.total), ...partition.members.map((member) => at(cell, member))]);
    }
    for (const pair of SUBSET_PAIRS) {
      relations.push([at(cell, pair.superset), at(cell, pair.subset), at(cell, complementOf(pair))]);
    }
  }
  const kids = new Map<string, string[]>();
  for (const [cell, parent] of cube.parentOf) {
    if (!parent) continue;
    kids.set(parent, [...(kids.get(parent) ?? []), cell]);
  }
  const everyVariable = [
    ...SUM_PARTITIONS.flatMap((partition) => [partition.total, ...partition.members]),
    ...SUBSET_PAIRS.flatMap((pair) => [pair.superset, pair.subset, complementOf(pair)]),
  ];
  for (const [parent, children] of kids) {
    for (const variable of new Set(everyVariable)) {
      relations.push([at(parent, variable), ...children.map((child) => at(child, variable))]);
    }
  }
  return relations;
}

/** Exact-enough row reduction; every coefficient here is 1 or -1 to begin with. */
function reduce(rows: number[][], width: number): number[][] {
  const matrix = rows.map((row) => [...row]);
  let pivotRow = 0;
  for (let column = 0; column < width && pivotRow < matrix.length; column += 1) {
    let candidate = -1;
    for (let row = pivotRow; row < matrix.length; row += 1) {
      if (Math.abs(matrix[row]![column]!) > 1e-9) { candidate = row; break; }
    }
    if (candidate === -1) continue;
    [matrix[pivotRow], matrix[candidate]] = [matrix[candidate]!, matrix[pivotRow]!];
    const scale = matrix[pivotRow]![column]!;
    for (let c = 0; c < width; c += 1) matrix[pivotRow]![c]! /= scale;
    for (let row = 0; row < matrix.length; row += 1) {
      if (row === pivotRow) continue;
      const factor = matrix[row]![column]!;
      if (Math.abs(factor) < 1e-9) continue;
      for (let c = 0; c < width; c += 1) matrix[row]![c]! -= factor * matrix[pivotRow]![c]!;
    }
    pivotRow += 1;
  }
  return matrix.slice(0, pivotRow);
}

/**
 * Every group of fewer than `k` people the released rows hand over, as readable
 * strings. Empty means nothing below the threshold is recoverable.
 */
export function derivableLeaks(
  groups: readonly CalculatedMetricGroup[], released: readonly ReleasedAggregate[], k: number,
): string[] {
  const cube = buildCube(groups, released);
  const unknowns: string[] = [];
  for (const cell of cube.cells) {
    for (const variable of new Set([
      ...SUM_PARTITIONS.flatMap((partition) => [partition.total, ...partition.members]),
      ...SUBSET_PAIRS.flatMap((pair) => [pair.superset, pair.subset, complementOf(pair)]),
    ])) {
      if (!statedOutright(cube, cell, variable)) unknowns.push(at(cell, variable));
    }
  }
  const column = new Map(unknowns.map((id, index) => [id, index]));

  const rows: number[][] = [];
  for (const relation of relationsOf(cube)) {
    const [total, ...rest] = relation;
    if (!relation.some((id) => backedByRow(cube, id))) continue;
    const row = new Array<number>(unknowns.length).fill(0);
    let touched = false;
    const place = (id: string, coefficient: number): void => {
      const index = column.get(id);
      if (index === undefined) return;
      row[index]! += coefficient;
      touched = true;
    };
    place(total!, 1);
    for (const member of rest) place(member, -1);
    if (touched) rows.push(row);
  }

  const leaks: string[] = [];
  for (const row of reduce(rows, unknowns.length)) {
    const involved = unknowns.filter((_, index) => Math.abs(row[index]!) > 1e-9);
    if (involved.length === 0) continue;
    const people = new Set<string>();
    for (const id of involved) for (const person of cube.support.get(id) ?? []) people.add(person);
    if (people.size === 0 || people.size >= k) continue;
    const shape = involved.length === 1 ? 'recovered outright' : 'residual';
    leaks.push(`${shape}: ${involved.join(' + ')} over ${people.size} people`);
  }
  return leaks.sort();
}

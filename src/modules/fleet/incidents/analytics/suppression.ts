/**
 * Which aggregate rows may be stored, and therefore published.
 *
 * ## Why this is a tier rule and not a search
 *
 * Three designs preceded it. Each published what looked safe cell by cell, then
 * searched for what a reader could recover. Every review found another channel
 * the search had missed — across levels, across metric keys, through a
 * denominator column, through `contributor_count`, through a histogram bucket —
 * and every fix made the output emptier: the last withheld about four rows in
 * five on a realistic month and still had holes.
 *
 * So the question changed. Publish only sets that are CLOSED under the
 * arithmetic: within a set, every quantity a reader can compute is one whose
 * support already clears the threshold. Then there is nothing to search for.
 *
 * ## The rule
 *
 * The unit of decision is a (level, dimension, COMPONENT) — a connected piece of
 * `metricRelations.ts`. Two variables in different components have no arithmetic
 * between them, so each component is decided on its own. Three tiers:
 *
 * - **FULL** — every variable in the component clears `k` or has nobody behind
 *   it at all: every member, every total, and every complement of every subset
 *   and partition relation. Publish the whole component, denominators included.
 * - **TOTAL_ONLY** — else, if the component's ROOT total clears `k`, publish
 *   that one row and nothing else. One value per component means no difference
 *   can be taken inside it.
 * - **NONE** — otherwise nothing.
 *
 * A component rooted on an internal tally — incidents are, because
 * `incident.total` is no metric key — has no row to publish at TOTAL_ONLY, so
 * for those two tiers collapse into one.
 *
 * ## The two things that make it provable
 *
 * **Sites are never published.** Migration 527's view exposes organisation and
 * project rows only, and neither `contributor_count` nor any histogram column.
 * A whole class of channel disappears with the columns.
 *
 * **The organisation takes the MINIMUM tier over its projects**, and must clear
 * its own check at that tier besides. This is what closes cross-level
 * differencing, and the proof is one line: every key the organisation publishes
 * is published by EVERY project, so `organisation - sum(projects) = 0` and the
 * difference carries no information. Without the minimum, the organisation's row
 * minus the projects that survived would be the withheld projects' sum — which
 * is exactly the residual three designs kept failing to bound.
 *
 * Within a component the argument is as short. Any value a reader computes is a
 * linear combination of that component's variables; at FULL every one of those
 * clears `k`, and at TOTAL_ONLY there is a single value and so no combination to
 * take. Across components there is no relation at all. See
 * `.claude/modules/fleet-analytics-disclosure.md` for what this does NOT claim.
 *
 * Pure: no SQL, no clock, no configuration lookup. The threshold is passed in
 * from the effective settings row.
 */
import type { AggregateDimensionLevel, AggregateMetricKind, OperationsMetricKey } from './aggregateSchema';
import { metricKindFor } from './aggregateSchema';
import type { CalculatedMetricGroup } from './facts';
import type { CalculatedSiteMonth } from './metricCalculator';
import type { MetricComponent } from './metricRelations';
import { METRIC_COMPONENTS } from './metricRelations';
import type { DurationHistogram } from './types';

export interface ReleasedAggregate {
  monthStart: string;
  metricVersion: number;
  dimensionLevel: AggregateDimensionLevel;
  dimensionProjectId: string | null;
  dimensionSiteId: string | null;
  metricKey: OperationsMetricKey;
  metricKind: AggregateMetricKind;
  numerator: number;
  denominator: number | null;
  histogram: DurationHistogram | null;
  contributorCount: number;
}

export const RELEASE_TIERS = ['none', 'total_only', 'full'] as const;
export type ReleaseTier = (typeof RELEASE_TIERS)[number];

interface Accumulator {
  numerator: number;
  denominator: number | null;
  histogram: DurationHistogram | null;
  contributors: Set<string>;
}

/** One (month, version, level, dimension) — the scope a tier is decided for. */
interface Cell {
  monthStart: string;
  metricVersion: number;
  level: AggregateDimensionLevel;
  projectId: string | null;
  /** Metric keys and internal variables alike. */
  values: Map<string, Accumulator>;
}

const emptyAccumulator = (): Accumulator => ({ numerator: 0, denominator: null, histogram: null, contributors: new Set() });

/** Adds `source` into `target` in place. Contributors UNION; they never add. */
function accumulate(target: Accumulator, source: Accumulator): void {
  target.numerator += source.numerator;
  if (source.denominator !== null) target.denominator = (target.denominator ?? 0) + source.denominator;
  const incoming = source.histogram;
  if (incoming) {
    const base = target.histogram
      ?? { sampleCount: 0, sumSeconds: 0, buckets: incoming.buckets.map(() => 0) };
    target.histogram = {
      sampleCount: base.sampleCount + incoming.sampleCount,
      sumSeconds: base.sumSeconds + incoming.sumSeconds,
      buckets: base.buckets.map((count, index) => count + (incoming.buckets[index] ?? 0)),
    };
  }
  for (const contributor of source.contributors) target.contributors.add(contributor);
}

function accumulatorFrom(group: CalculatedMetricGroup): Accumulator {
  return {
    numerator: group.numerator,
    denominator: group.denominator,
    histogram: group.histogram ? { ...group.histogram, buckets: [...group.histogram.buckets] } : null,
    contributors: new Set(group.contributors),
  };
}

function addInto(cell: Cell, variable: string, source: Accumulator): void {
  const target = cell.values.get(variable) ?? emptyAccumulator();
  cell.values.set(variable, target);
  accumulate(target, source);
}

/**
 * Rolls the site-months up into the two levels that may be published. Sites are
 * summed and then dropped: they are the input to a project's numbers, never a
 * row. Internal variables roll up the same way — a project's tier turns on who
 * is behind the PROJECT's complements, not on any one site's.
 */
function rollUp(siteMonths: readonly CalculatedSiteMonth[]): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  const cellFor = (
    monthStart: string, metricVersion: number, level: AggregateDimensionLevel, projectId: string | null,
  ): Cell => {
    const id = `${monthStart}|${metricVersion}|${level}|${projectId ?? ''}`;
    const existing = cells.get(id);
    if (existing) return existing;
    const created: Cell = { monthStart, metricVersion, level, projectId, values: new Map() };
    cells.set(id, created);
    return created;
  };

  for (const siteMonth of siteMonths) {
    const scopes = [
      cellFor(siteMonth.monthStart, siteMonth.metricVersion, 'project', siteMonth.projectId),
      cellFor(siteMonth.monthStart, siteMonth.metricVersion, 'organisation', null),
    ];
    for (const group of siteMonth.groups) {
      const source = accumulatorFrom(group);
      for (const scope of scopes) addInto(scope, group.metricKey, source);
    }
    for (const [variable, contributors] of siteMonth.internalSupport) {
      const source = { ...emptyAccumulator(), contributors: new Set(contributors) };
      for (const scope of scopes) addInto(scope, variable, source);
    }
  }
  return cells;
}

const supportSize = (cell: Cell, variable: string): number =>
  cell.values.get(variable)?.contributors.size ?? 0;

/**
 * Everyone behind a partition member's complement: the other members, unioned —
 * exact, because a partition is exhaustive. Subset complements cannot be reached
 * this way and are tallied by `metricCalculator` instead.
 */
function partitionComplementSize(cell: Cell, component: MetricComponent, member: string): number {
  const partition = component.partitions.find((candidate) => candidate.members.some((m) => m === member));
  if (!partition) return 0;
  const people = new Set<string>();
  for (const other of partition.members) {
    if (other === member) continue;
    for (const person of cell.values.get(other)?.contributors ?? []) people.add(person);
  }
  return people.size;
}

/**
 * The tier a cell can support for one component, from its own numbers alone. A
 * support of zero passes every check: the value is zero, it describes nobody,
 * and a reader who derives it learns only that nothing happened.
 */
function ownTier(cell: Cell, component: MetricComponent, minimumContributors: number): ReleaseTier {
  const clears = (size: number): boolean => size === 0 || size >= minimumContributors;
  const full = component.variables.every((variable) => clears(supportSize(cell, variable)))
    && component.partitions.every(
      (partition) => partition.members.every(
        (member) => clears(partitionComplementSize(cell, component, member)),
      ),
    );
  if (full) return 'full';
  return supportSize(cell, component.root) >= minimumContributors ? 'total_only' : 'none';
}

const rank = (tier: ReleaseTier): number => RELEASE_TIERS.indexOf(tier);
const lower = (a: ReleaseTier, b: ReleaseTier): ReleaseTier => (rank(a) <= rank(b) ? a : b);

function toRow(cell: Cell, key: OperationsMetricKey, value: Accumulator, withDenominator: boolean): ReleasedAggregate {
  const denominator = withDenominator ? value.denominator : null;
  return {
    monthStart: cell.monthStart,
    metricVersion: cell.metricVersion,
    dimensionLevel: cell.level,
    dimensionProjectId: cell.projectId,
    dimensionSiteId: null,
    metricKey: key,
    metricKind: metricKindFor(key, denominator),
    numerator: value.numerator,
    denominator,
    histogram: value.histogram,
    contributorCount: value.contributors.size,
  };
}

/** The rows one component contributes at one cell, given its decided tier. */
function rowsFor(
  cell: Cell, component: MetricComponent, tier: ReleaseTier, minimumContributors: number,
): ReleasedAggregate[] {
  const publish = (key: OperationsMetricKey, withDenominator: boolean): ReleasedAggregate[] => {
    const value = cell.values.get(key);
    // A metric nobody contributed to is withheld rather than published as a
    // zero: the table's `contributor_count >= 5` could not hold it anyway, and
    // a reader recovers the zero from the rest of the component regardless.
    if (!value || value.contributors.size < minimumContributors) return [];
    return [toRow(cell, key, value, withDenominator)];
  };
  if (tier === 'full') return component.keys.flatMap((key) => publish(key, true));
  if (tier === 'total_only' && component.rootKey) return publish(component.rootKey, false);
  return [];
}

const LEVEL_ORDER: Record<AggregateDimensionLevel, number> = { site: 0, project: 1, organisation: 2 };

/**
 * The tier every (cell, component) settles on, organisation minimum included.
 * One traversal serves both the release and the usability report, so the rule
 * the two describe cannot drift apart.
 */
function decide(
  siteMonths: readonly CalculatedSiteMonth[], minimumContributors: number,
): { cell: Cell; component: MetricComponent; tier: ReleaseTier }[] {
  const cells = rollUp(siteMonths);
  const projects = [...cells.values()].filter((cell) => cell.level === 'project');
  const decided: { cell: Cell; component: MetricComponent; tier: ReleaseTier }[] = [];
  for (const cell of cells.values()) {
    for (const component of METRIC_COMPONENTS) {
      let tier = ownTier(cell, component, minimumContributors);
      if (cell.level === 'organisation') {
        for (const project of projects) {
          if (project.monthStart !== cell.monthStart) continue;
          if (project.metricVersion !== cell.metricVersion) continue;
          tier = lower(tier, ownTier(project, component, minimumContributors));
        }
      }
      decided.push({ cell, component, tier });
    }
  }
  return decided;
}

/**
 * Releases the rows that may be stored, in a stable order so a re-run is
 * byte-identical and the checksum settles.
 */
export function releaseAnonymousGroups(
  siteMonths: readonly CalculatedSiteMonth[],
  minimumContributors: number,
): ReleasedAggregate[] {
  const rows = decide(siteMonths, minimumContributors).flatMap(
    ({ cell, component, tier }) => rowsFor(cell, component, tier, minimumContributors),
  );
  return rows.sort(
    (a, b) => a.monthStart.localeCompare(b.monthStart)
      || a.metricKey.localeCompare(b.metricKey)
      || LEVEL_ORDER[a.dimensionLevel] - LEVEL_ORDER[b.dimensionLevel]
      || (a.dimensionProjectId ?? '').localeCompare(b.dimensionProjectId ?? ''),
  );
}

/** The tier each component reached, for the usability and disclosure tests. */
export function releaseTiers(
  siteMonths: readonly CalculatedSiteMonth[], minimumContributors: number,
): Map<string, ReleaseTier> {
  return new Map(decide(siteMonths, minimumContributors).map(
    ({ cell, component, tier }) => [
      `${cell.monthStart}|${cell.level}|${cell.projectId ?? ''}|${component.root}`, tier,
    ],
  ));
}

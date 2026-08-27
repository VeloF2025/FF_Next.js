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
 * ## The organisation, and the cell that does not exist
 *
 * No site row is ever built: `decide` works at organisation and project level
 * and nothing below. Migration 527's view restricts to those two levels anyway,
 * as defence in depth against a future writer and against the site rows earlier
 * versions of this code left in the table, and publishes neither
 * `contributor_count` nor any histogram column — a whole class of channel
 * disappears with those. A project therefore has no published children and
 * nothing to be differenced against.
 *
 * The organisation does. Subtract the projects that published from the
 * organisation and what is left is the sum of the projects that did not — so
 * that sum has to be safe. `organisationTier` builds it: ONE VIRTUAL CELL over
 * exactly the withheld projects, with supports UNIONED and complements taken
 * from the calculator's own tallies, and asks it to pass the same tier check
 * every real cell passes. The organisation publishes at the highest tier where
 * both its own check and the virtual cell's hold.
 *
 * ### The proof
 *
 * Fix a component and a tier `T`, and let `W` be the projects not publishing at
 * `T` or better.
 *
 * 1. **Within a published component at FULL**, any value a reader computes is a
 *    linear combination of that component's variables, and every one of them
 *    clears `k`. At TOTAL_ONLY there is a single value and so no combination to
 *    take. Across components there is no relation at all.
 * 2. **Across levels**, for every key the organisation publishes at `T`, each
 *    project outside `W` publishes it too — a higher tier publishes a superset
 *    of a lower tier's keys. So `organisation - sum(projects outside W)` is
 *    exactly the virtual cell's value for that key, and the virtual cell passed
 *    the tier-`T` check: at FULL every one of its variables clears `k`, at
 *    TOTAL_ONLY its root does.
 * 3. **The reader can recover the virtual cell's whole component**, not just one
 *    key of it, which is why the check has to be the full tier check and not
 *    merely "its total clears `k`". Where `W` is a single project the virtual
 *    cell IS that project, so that project must itself pass in full,
 *    complements included — the case a weaker relaxation would leak through.
 * 4. **Where `W` is empty** the virtual cell has nobody behind anything, every
 *    check passes vacuously, and the difference is zero.
 *
 * This replaced taking the MINIMUM tier over the projects, which is the special
 * case of the above that refuses whenever `W` is non-empty. It was sound and
 * needlessly lossy: one four-person project silenced the organisation entirely.
 *
 * Pure: no SQL, no clock, no configuration lookup. The threshold is passed in
 * from the effective settings row.
 */
import type { AggregateDimensionLevel, AggregateMetricKind, OperationsMetricKey } from './aggregateSchema';
import { metricKindFor } from './aggregateSchema';
import type { CalculatedSiteMonth } from './metricCalculator';
import type { MetricComponent } from './metricRelations';
import { METRIC_COMPONENTS } from './metricRelations';
import type { Accumulator, Cell, MonthScope } from './releaseCells';
import { buildCell, monthScopes, supportSize } from './releaseCells';
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

const rank = (tier: ReleaseTier): number => RELEASE_TIERS.indexOf(tier);

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

/**
 * The highest tier at which the organisation may publish.
 *
 * Three conditions, and the middle one is the one a randomised sweep had to
 * teach me.
 *
 * 1. The organisation's own numbers pass the tier-`T` check.
 * 2. **Every project is all-in or all-out**: it publishes at `T` or better, or
 *    it publishes nothing at all. A project sitting in between — publishing its
 *    root total while the organisation publishes members — couples the two
 *    groups through the organisation's member values, and combinations across
 *    that coupling can pin down a handful of people. Seed 196 of the sweep is
 *    exactly that shape: three projects, one at TOTAL_ONLY, the organisation at
 *    FULL, and a four-person residual falling out of the arithmetic.
 * 3. The projects publishing nothing, aggregated into ONE VIRTUAL CELL with
 *    supports unioned and complements taken from the calculator's own tallies,
 *    pass the tier-`T` check themselves.
 */
function organisationTier(
  scope: MonthScope, organisation: Cell, projectTiers: ReadonlyMap<string, ReleaseTier>,
  component: MetricComponent, minimumContributors: number,
): ReleaseTier {
  const own = ownTier(organisation, component, minimumContributors);
  const tierOf = (projectId: string): ReleaseTier => projectTiers.get(projectId) ?? 'none';
  const silent = [...scope.byProject.entries()].filter(([projectId]) => tierOf(projectId) === 'none');

  for (const tier of ['full', 'total_only'] as const) {
    if (rank(own) < rank(tier)) continue;
    const allInOrAllOut = [...scope.byProject.keys()].every(
      (projectId) => tierOf(projectId) === 'none' || rank(tierOf(projectId)) >= rank(tier),
    );
    if (!allInOrAllOut) continue;
    const virtual = buildCell(
      silent.flatMap(([, siteMonths]) => siteMonths), scope.monthStart, scope.metricVersion,
      'organisation', null,
    );
    if (rank(ownTier(virtual, component, minimumContributors)) >= rank(tier)) return tier;
  }
  return 'none';
}

function toRow(
  cell: Cell, key: OperationsMetricKey, value: Accumulator, withDenominator: boolean,
): ReleasedAggregate {
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

interface Decision {
  cell: Cell;
  component: MetricComponent;
  tier: ReleaseTier;
}

/**
 * The tier every (cell, component) settles on. One traversal serves both the
 * release and the usability report, so the rule the two describe cannot drift.
 */
function decide(siteMonths: readonly CalculatedSiteMonth[], minimumContributors: number): Decision[] {
  const decided: Decision[] = [];
  for (const scope of monthScopes(siteMonths)) {
    const { monthStart, metricVersion } = scope;
    const projects = new Map(
      [...scope.byProject.entries()].map(
        ([projectId, months]) => [projectId, buildCell(months, monthStart, metricVersion, 'project', projectId)],
      ),
    );
    const organisation = buildCell(
      [...scope.byProject.values()].flat(), monthStart, metricVersion, 'organisation', null,
    );

    for (const component of METRIC_COMPONENTS) {
      const tiers = new Map(
        [...projects.entries()].map(
          ([projectId, cell]) => [projectId, ownTier(cell, component, minimumContributors)],
        ),
      );
      for (const [projectId, cell] of projects) {
        decided.push({ cell, component, tier: tiers.get(projectId)! });
      }
      decided.push({
        cell: organisation,
        component,
        tier: organisationTier(scope, organisation, tiers, component, minimumContributors),
      });
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

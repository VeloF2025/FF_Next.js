/**
 * Turns per-site calculated groups into the rows that may actually be stored.
 *
 * ## What this does and does NOT guarantee
 *
 * Read `.claude/modules/fleet-analytics-disclosure.md` before exposing any of
 * this through an API, an export, or a UI. Two of the blockers it listed are
 * now closed - see below - but the weaker items in its section 3 are not, and
 * this module is still not a general statistical disclosure control.
 *
 * What it closes, in three stages - the first two heuristics that make good
 * local choices, the third the rule that actually has to hold:
 *
 * 1. Cross-level differencing. `contributor_count >= 5` is a per-row guard, and
 *    a per-row guard cannot see that subtracting a parent's published children
 *    from the parent recovers the withheld ones. So siblings are withheld until
 *    that residual itself describes enough people - `applyComplementarySuppression`
 *    in `releaseCells.ts`.
 *
 * 2. Cross-KEY differencing. The metric keys are not independent: three
 *    families of them sum to a total that is published in its own right, as a
 *    row for presence and as the shared denominator everywhere else. Withholding
 *    one member while publishing its siblings and their total gave the member
 *    back by subtraction, and rule 1 never looked across keys. `metricPartitions.ts`
 *    is that second axis, applied at every cell by `applyPartitionRule`.
 *
 * 3. DERIVABILITY, which is the only one of the three that is a guarantee. Both
 *    rules above decide per cell, against what was published THERE. A reader
 *    chains the relations instead: subtract a project's published children to
 *    recover a withheld site, feed that into the same site's partition, and a
 *    second withheld cell falls out that neither rule ever examined. Both
 *    blocking findings on PR #2604 were of that shape. `derivability.ts` closes
 *    over every relation at once and reports what the published set determines;
 *    `repairDerivability` below withholds rows, smallest support first, until it
 *    determines nothing about a group smaller than the threshold.
 *
 * The stages interact: a sacrifice made across keys can withhold a parent whose
 * children rule 1 had already published, so `cascadeWithholding` re-establishes
 * "a withheld parent publishes nothing beneath it" after each of them.
 *
 * It is also the last place a contributor identity exists. Groups arrive with a
 * `Set<string>` of contributor keys and leave with a count; `ReleasedAggregate`
 * has no field that can hold a person.
 *
 * Pure: no SQL, no clock, no configuration lookup. The threshold is passed in
 * from the effective settings row.
 */
import type { AggregateDimensionLevel, AggregateMetricKind, OperationsMetricKey } from './aggregateSchema';
import { metricKindFor } from './aggregateSchema';
import type { DerivationValue } from './derivability';
import { derivabilityViolations, valueIdOf } from './derivability';
import type { CalculatedMetricGroup } from './facts';
import { partitionSacrifices } from './metricPartitions';
import type { ReleaseCell } from './releaseCells';
import { releaseSliceCells } from './releaseCells';
import type { DurationHistogram } from './types';

export interface ReleasedAggregate {
  monthStart: string;
  metricVersion: number;
  dimensionLevel: AggregateDimensionLevel;
  dimensionProjectId: string | null;
  dimensionSiteId: string | null;
  generalizedFromLevel: AggregateDimensionLevel | null;
  metricKey: OperationsMetricKey;
  metricKind: AggregateMetricKind;
  numerator: number;
  denominator: number | null;
  histogram: DurationHistogram | null;
  contributorCount: number;
}

function toRow(
  monthStart: string,
  metricVersion: number,
  metricKey: OperationsMetricKey,
  level: AggregateDimensionLevel,
  projectId: string | null,
  siteId: string | null,
  generalizedFrom: AggregateDimensionLevel | null,
  accumulator: ReleaseCell['accumulator'],
): ReleasedAggregate {
  return {
    monthStart,
    metricVersion,
    dimensionLevel: level,
    dimensionProjectId: projectId,
    dimensionSiteId: siteId,
    generalizedFromLevel: generalizedFrom,
    metricKey,
    metricKind: metricKindFor(metricKey, accumulator.denominator),
    numerator: accumulator.numerator,
    denominator: accumulator.denominator,
    histogram: accumulator.histogram,
    contributorCount: accumulator.contributors.size,
  };
}

const LEVEL_ORDER: Record<AggregateDimensionLevel, number> = { site: 0, project: 1, organisation: 2 };

/**
 * Releases every group that may be published, generalizing or withholding the
 * rest. Returns rows in a stable order so a re-run is byte-identical.
 */
/** Identifies one cell across metric keys — the axis the partition rule works on. */
function cellId(cell: ReleaseCell): string {
  return `${cell.monthStart}|${cell.metricVersion}|${cell.level}|${cell.projectId ?? ''}|${cell.siteId ?? ''}`;
}

/**
 * Withholds the members the partition rule demands, at every cell independently.
 * Returns whether anything changed, because withholding more can create a new
 * violation elsewhere — see the fixed point in `releaseAnonymousGroups`.
 */
function applyPartitionRule(cells: readonly ReleaseCell[], minimumContributors: number): boolean {
  const byCell = new Map<string, ReleaseCell[]>();
  for (const cell of cells) {
    const bucket = byCell.get(cellId(cell)) ?? [];
    bucket.push(cell);
    byCell.set(cellId(cell), bucket);
  }

  let changed = false;
  for (const bucket of byCell.values()) {
    const sacrifices = new Set(partitionSacrifices(
      bucket.map((cell) => ({
        metricKey: cell.metricKey, contributors: cell.accumulator.contributors, published: cell.published,
      })),
      minimumContributors,
    ));
    if (sacrifices.size === 0) continue;
    for (const cell of bucket) {
      if (cell.published && sacrifices.has(cell.metricKey)) { cell.published = false; changed = true; }
    }
  }
  return changed;
}

/**
 * A withheld parent publishes nothing beneath it: its children would rebuild it.
 * The per-key pass already honours this, but the partition rule can withhold a
 * parent afterwards, so it has to be re-established.
 */
function cascadeWithholding(cells: readonly ReleaseCell[]): boolean {
  const withheldOrganisation = new Set<string>();
  const withheldProject = new Set<string>();
  for (const cell of cells) {
    if (cell.published) continue;
    if (cell.level === 'organisation') withheldOrganisation.add(`${cell.monthStart}|${cell.metricVersion}|${cell.metricKey}`);
    if (cell.level === 'project') withheldProject.add(`${cell.monthStart}|${cell.metricVersion}|${cell.metricKey}|${cell.projectId}`);
  }

  let changed = false;
  for (const cell of cells) {
    if (!cell.published) continue;
    const orphanedByOrganisation = cell.level !== 'organisation'
      && withheldOrganisation.has(`${cell.monthStart}|${cell.metricVersion}|${cell.metricKey}`);
    const orphanedByProject = cell.level === 'site'
      && withheldProject.has(`${cell.monthStart}|${cell.metricVersion}|${cell.metricKey}|${cell.projectId}`);
    if (orphanedByOrganisation || orphanedByProject) { cell.published = false; changed = true; }
  }
  return changed;
}

/**
 * A published parent whose children were not all published says so on the row.
 * Computed from the final decision rather than from the per-key pass, so a
 * sacrifice made by the partition rule is disclosed the same way.
 */
function generalizedFrom(cell: ReleaseCell, cells: readonly ReleaseCell[]): AggregateDimensionLevel | null {
  if (cell.level === 'site') return null;
  const childLevel = cell.level === 'project' ? 'site' : 'project';
  const withheldChild = cells.some((candidate) => (
    candidate.level === childLevel
    && candidate.metricKey === cell.metricKey
    && candidate.monthStart === cell.monthStart
    && candidate.metricVersion === cell.metricVersion
    && (cell.level === 'organisation' || candidate.projectId === cell.projectId)
    && !candidate.published
  ));
  return withheldChild ? childLevel : null;
}

/** The scope one level up, which the level relations are built from. */
function parentCellId(cell: ReleaseCell): string | null {
  const stem = `${cell.monthStart}|${cell.metricVersion}`;
  if (cell.level === 'site') return `${stem}|project|${cell.projectId ?? ''}|`;
  if (cell.level === 'project') return `${stem}|organisation||`;
  return null;
}

function derivationValues(cells: readonly ReleaseCell[]): DerivationValue[] {
  return cells.map((cell) => ({
    cellId: cellId(cell),
    parentCellId: parentCellId(cell),
    metricKey: cell.metricKey,
    contributors: cell.accumulator.contributors,
    published: cell.published,
  }));
}

/**
 * Withholds rows until nothing below the threshold is DERIVABLE.
 *
 * The two heuristics above have already made the cheap, well-targeted choices;
 * what is left is whatever survived them and still chains. Each round takes the
 * first violation in a deterministic order and withholds one of the published
 * rows the reader's arithmetic rests on - smallest support first, ties broken on
 * the row's identity, so a re-run produces the same rows and the same checksum.
 *
 * It terminates because every round withholds a row that was published, and it
 * is correct in the limit for the same reason: with nothing published, no
 * relation is anchored and nothing is derivable. In practice it settles after a
 * handful of rounds, because the heuristics leave little for it to do.
 */
function repairDerivability(cells: readonly ReleaseCell[], minimumContributors: number): void {
  const byValueId = new Map(cells.map((cell) => [valueIdOf(cellId(cell), cell.metricKey), cell]));
  for (let round = 0; round <= cells.length; round += 1) {
    const violations = derivabilityViolations(derivationValues(cells), minimumContributors);
    const first = violations[0];
    if (!first) return;
    const candidates = first.anchors
      .map((anchor) => byValueId.get(anchor))
      .filter((cell): cell is ReleaseCell => cell !== undefined && cell.published);
    const sacrifice = candidates.sort(
      (a, b) => a.accumulator.contributors.size - b.accumulator.contributors.size
        || valueIdOf(cellId(a), a.metricKey).localeCompare(valueIdOf(cellId(b), b.metricKey)),
    )[0];
    // Every violation is anchored on a published row, so there is always one to
    // give up; the guard is a backstop, not an expected path.
    if (!sacrifice) return;
    sacrifice.published = false;
    cascadeWithholding(cells);
  }
}

export function releaseAnonymousGroups(
  groups: readonly CalculatedMetricGroup[],
  minimumContributors: number,
): ReleasedAggregate[] {
  const slices = new Map<string, CalculatedMetricGroup[]>();
  for (const group of groups) {
    const key = `${group.monthStart} ${group.metricVersion} ${group.metricKey}`;
    const slice = slices.get(key) ?? [];
    slice.push(group);
    slices.set(key, slice);
  }

  const cells: ReleaseCell[] = [];
  for (const [key, slice] of slices) {
    const [monthStart, metricVersion, metricKey] = key.split(' ') as [string, string, OperationsMetricKey];
    cells.push(...releaseSliceCells(monthStart, Number(metricVersion), metricKey, slice, minimumContributors));
  }

  // With today's two rules this settles on the first pass, and a test does not
  // reach a second one: both only ever withhold cells that had already cleared
  // the threshold, so anything the cascade withholds adds at least
  // `minimumContributors` people to whatever residual it touches and cannot
  // open a new violation. The loop is the backstop for a future rule without
  // that property; it terminates because withholding is monotonic over finitely
  // many cells.
  for (let pass = 0; pass <= cells.length; pass += 1) {
    const partitioned = applyPartitionRule(cells, minimumContributors);
    const cascaded = cascadeWithholding(cells);
    if (!partitioned && !cascaded) break;
  }

  repairDerivability(cells, minimumContributors);

  const rows: ReleasedAggregate[] = [];
  for (const cell of cells) {
    if (!cell.published) continue;
    rows.push(toRow(
      cell.monthStart, cell.metricVersion, cell.metricKey, cell.level,
      cell.projectId, cell.siteId, generalizedFrom(cell, cells), cell.accumulator,
    ));
  }

  return rows.sort(
    (a, b) => a.monthStart.localeCompare(b.monthStart)
      || a.metricKey.localeCompare(b.metricKey)
      || LEVEL_ORDER[a.dimensionLevel] - LEVEL_ORDER[b.dimensionLevel]
      || (a.dimensionProjectId ?? '').localeCompare(b.dimensionProjectId ?? '')
      || (a.dimensionSiteId ?? '').localeCompare(b.dimensionSiteId ?? ''),
  );
}

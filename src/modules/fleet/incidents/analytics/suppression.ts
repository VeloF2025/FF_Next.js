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
 * What it closes, on two axes:
 *
 * 1. Cross-level differencing. `contributor_count >= 5` is a per-row guard, and
 *    a per-row guard cannot see that subtracting a parent's published children
 *    from the parent recovers the withheld ones. So siblings are withheld until
 *    that residual itself describes enough people - `applyComplementarySuppression`.
 *
 * 2. Cross-KEY differencing. The metric keys are not independent: three
 *    families of them sum to a total that is published in its own right, as a
 *    row for presence and as the shared denominator everywhere else. Withholding
 *    one member while publishing its siblings and their total gave the member
 *    back by subtraction, and rule 1 never looked across keys. `metricPartitions.ts`
 *    is that second axis, applied at every cell by `applyPartitionRule`.
 *
 * The two interact: a sacrifice made by rule 2 can withhold a parent whose
 * children rule 1 had already published, so `cascadeWithholding` re-establishes
 * "a withheld parent publishes nothing beneath it" afterwards.
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
import type { CalculatedMetricGroup } from './facts';
import { partitionSacrifices } from './metricPartitions';
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

interface Accumulator {
  numerator: number;
  denominator: number | null;
  histogram: DurationHistogram | null;
  contributors: Set<string>;
}

function emptyAccumulator(): Accumulator {
  return { numerator: 0, denominator: null, histogram: null, contributors: new Set() };
}

/** Adds `source` into `target` in place. Contributors union; they never add. */
function accumulate(target: Accumulator, source: Accumulator): void {
  target.numerator += source.numerator;
  if (source.denominator !== null) {
    target.denominator = (target.denominator ?? 0) + source.denominator;
  }
  const incoming = source.histogram;
  if (incoming) {
    const base = target.histogram ?? {
      sampleCount: 0,
      sumSeconds: 0,
      buckets: incoming.buckets.map(() => 0),
    };
    target.histogram = {
      sampleCount: base.sampleCount + incoming.sampleCount,
      sumSeconds: base.sumSeconds + incoming.sumSeconds,
      buckets: base.buckets.map((n, i) => n + (incoming.buckets[i] ?? 0)),
    };
  }
  for (const contributor of source.contributors) target.contributors.add(contributor);
}

function accumulatorFrom(group: CalculatedMetricGroup): Accumulator {
  return {
    numerator: group.numerator,
    denominator: group.denominator,
    histogram: group.histogram
      ? { ...group.histogram, buckets: [...group.histogram.buckets] }
      : null,
    contributors: new Set(group.contributors),
  };
}

interface Candidate {
  id: string;
  accumulator: Accumulator;
}

/**
 * Decides which children of one parent may be published.
 *
 * Children below the threshold are always withheld. What matters after that is
 * the RESIDUAL - what a reader recovers by subtracting the published children
 * from the parent. The residual is the union of every withheld child, and it
 * must itself describe at least `minimumContributors` people.
 *
 * Requiring merely that two or more children be withheld is NOT enough, and
 * that error is why this comment is long: two sites of two people each leave a
 * four-person residual that the parent row hands over exactly, with
 * `contributor_count` even stating the headcount. So siblings are withheld,
 * smallest first, until the residual clears the threshold or nothing is left to
 * publish. Ties break on the lower id, so two runs over the same month produce
 * the same rows and therefore the same checksum.
 *
 * When everything ends up withheld, nothing is published at this level and the
 * parent alone carries the numbers - which discloses nothing, because the
 * residual is then the parent itself.
 *
 * Contributors are UNIONED, never summed: one person working two sites is one
 * person in the residual.
 */
function applyComplementarySuppression(
  children: readonly Candidate[],
  minimumContributors: number,
): { published: Candidate[]; withheldCount: number } {
  const published = children.filter((c) => c.accumulator.contributors.size >= minimumContributors);
  const withheld = children.filter((c) => c.accumulator.contributors.size < minimumContributors);

  // Smallest first, then lowest id: the order siblings are sacrificed in, and
  // deterministic so a re-run produces byte-identical rows.
  published.sort(
    (a, b) => a.accumulator.contributors.size - b.accumulator.contributors.size
      || a.id.localeCompare(b.id),
  );

  const residual = new Set<string>();
  for (const child of withheld) {
    for (const contributor of child.accumulator.contributors) residual.add(contributor);
  }

  // Nothing withheld means no residual to protect.
  while (withheld.length > 0 && residual.size < minimumContributors && published.length > 0) {
    const sacrificed = published.shift();
    if (!sacrificed) break;
    withheld.push(sacrificed);
    for (const contributor of sacrificed.accumulator.contributors) residual.add(contributor);
  }

  return { published, withheldCount: withheld.length };
}

function toRow(
  monthStart: string,
  metricVersion: number,
  metricKey: OperationsMetricKey,
  level: AggregateDimensionLevel,
  projectId: string | null,
  siteId: string | null,
  generalizedFrom: AggregateDimensionLevel | null,
  accumulator: Accumulator,
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

/**
 * One cell of the cube: one metric key at one level of one month. Carries the
 * per-key decision AND the contributor set behind it, because the partition rule
 * runs after this and needs the support, not the count.
 */
interface ReleaseCell {
  monthStart: string;
  metricVersion: number;
  metricKey: OperationsMetricKey;
  level: AggregateDimensionLevel;
  projectId: string | null;
  siteId: string | null;
  accumulator: Accumulator;
  published: boolean;
}

/**
 * One (month, metric) slice: sites -> projects -> organisation.
 *
 * Returns cells rather than rows. Every cell the slice knows about is returned,
 * withheld ones included — `applyPartitionRule` has to see what was withheld to
 * work out whether the withholding gave anything away.
 */
function releaseSliceCells(
  monthStart: string,
  metricVersion: number,
  metricKey: OperationsMetricKey,
  groups: readonly CalculatedMetricGroup[],
  minimumContributors: number,
): ReleaseCell[] {
  const byProject = new Map<string, Candidate[]>();
  for (const group of groups) {
    const sites = byProject.get(group.projectId) ?? [];
    sites.push({ id: group.operationalSiteId, accumulator: accumulatorFrom(group) });
    byProject.set(group.projectId, sites);
  }

  const projects: Candidate[] = [];
  const publishedSites = new Map<string, Set<string>>();
  for (const [projectId, sites] of byProject) {
    const accumulator = emptyAccumulator();
    for (const site of sites) accumulate(accumulator, site.accumulator);
    projects.push({ id: projectId, accumulator });
    const decision = applyComplementarySuppression(sites, minimumContributors);
    publishedSites.set(projectId, new Set(decision.published.map((candidate) => candidate.id)));
  }

  const organisation = emptyAccumulator();
  for (const project of projects) accumulate(organisation, project.accumulator);
  // The organisation is a superset of every project, so if it cannot clear the
  // threshold nothing beneath it can either: the whole slice is withheld.
  const organisationPublished = organisation.contributors.size >= minimumContributors;
  const publishedProjects = new Set(
    organisationPublished
      ? applyComplementarySuppression(projects, minimumContributors).published.map((candidate) => candidate.id)
      : [],
  );

  const base = { monthStart, metricVersion, metricKey };
  const cells: ReleaseCell[] = [];
  for (const [projectId, sites] of byProject) {
    const sitesHere = publishedSites.get(projectId) ?? new Set<string>();
    for (const site of sites) {
      cells.push({
        ...base, level: 'site', projectId, siteId: site.id, accumulator: site.accumulator,
        published: organisationPublished && publishedProjects.has(projectId) && sitesHere.has(site.id),
      });
    }
  }
  for (const project of projects) {
    cells.push({
      ...base, level: 'project', projectId: project.id, siteId: null, accumulator: project.accumulator,
      published: organisationPublished && publishedProjects.has(project.id),
    });
  }
  cells.push({
    ...base, level: 'organisation', projectId: null, siteId: null, accumulator: organisation,
    published: organisationPublished,
  });
  return cells;
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

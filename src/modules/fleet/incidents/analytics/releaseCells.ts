/**
 * Building the cube of cells, and the cross-LEVEL half of the suppression rule.
 *
 * Split out of `suppression.ts` so that file can stay about the release
 * decision as a whole. Nothing here looks across metric keys: a slice is one
 * (month, version, metric key), rolled from sites to projects to the
 * organisation, and the only question asked of it is which siblings may survive
 * beside their parent. `metricPartitions.ts` is the across-keys axis and
 * `derivability.ts` is the closure over both.
 *
 * Pure: no SQL, no clock, no configuration lookup.
 */
import type { AggregateDimensionLevel, OperationsMetricKey } from './aggregateSchema';
import type { CalculatedMetricGroup } from './facts';
import type { DurationHistogram } from './types';

export interface Accumulator {
  numerator: number;
  denominator: number | null;
  histogram: DurationHistogram | null;
  contributors: Set<string>;
}

export function emptyAccumulator(): Accumulator {
  return { numerator: 0, denominator: null, histogram: null, contributors: new Set() };
}

/** Adds `source` into `target` in place. Contributors union; they never add. */
export function accumulate(target: Accumulator, source: Accumulator): void {
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

export function accumulatorFrom(group: CalculatedMetricGroup): Accumulator {
  return {
    numerator: group.numerator,
    denominator: group.denominator,
    histogram: group.histogram
      ? { ...group.histogram, buckets: [...group.histogram.buckets] }
      : null,
    contributors: new Set(group.contributors),
  };
}

export interface Candidate {
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
export function applyComplementarySuppression(
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

/**
 * One cell of the cube: one metric key at one level of one month. Carries the
 * per-key decision AND the contributor set behind it, because the partition rule
 * runs after this and needs the support, not the count.
 */
export interface ReleaseCell {
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
export function releaseSliceCells(
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

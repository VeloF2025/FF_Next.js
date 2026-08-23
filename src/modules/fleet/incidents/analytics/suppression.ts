/**
 * Turns per-site calculated groups into the rows that may actually be stored.
 *
 * `contributor_count >= 5` on `fleet_operational_monthly_aggregates` is a
 * per-row guard, and a per-row guard cannot see DIFFERENCING: if a project
 * publishes its total and all but one of its sites, subtracting recovers the
 * withheld site exactly. So this module withholds in pairs - see
 * `applyComplementarySuppression`. That rule, not the threshold, is the reason
 * this file exists.
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
 * Children below the threshold are always withheld. The complementary rule
 * follows: if that leaves exactly ONE withheld child, the parent's residual is
 * that child, so the smallest publishable sibling is withheld alongside it.
 * Ties break on the lower id, so two runs over the same month produce the same
 * rows and therefore the same checksum.
 *
 * When there is no sibling to pair with, nothing is published at this level and
 * the parent alone carries the numbers.
 */
function applyComplementarySuppression(
  children: readonly Candidate[],
  minimumContributors: number,
): { published: Candidate[]; withheldCount: number } {
  const passing = children.filter((c) => c.accumulator.contributors.size >= minimumContributors);
  const withheldCount = children.length - passing.length;

  if (withheldCount !== 1) return { published: passing, withheldCount };

  const ordered = [...passing].sort(
    (a, b) => a.accumulator.contributors.size - b.accumulator.contributors.size
      || a.id.localeCompare(b.id),
  );
  const sacrificed = ordered[0];
  if (!sacrificed) return { published: [], withheldCount };

  return {
    published: passing.filter((c) => c.id !== sacrificed.id),
    withheldCount: withheldCount + 1,
  };
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

/** One (month, metric) slice: sites -> projects -> organisation. */
function releaseSlice(
  monthStart: string,
  metricVersion: number,
  metricKey: OperationsMetricKey,
  groups: readonly CalculatedMetricGroup[],
  minimumContributors: number,
): ReleasedAggregate[] {
  const byProject = new Map<string, Candidate[]>();
  for (const group of groups) {
    const sites = byProject.get(group.projectId) ?? [];
    sites.push({ id: group.operationalSiteId, accumulator: accumulatorFrom(group) });
    byProject.set(group.projectId, sites);
  }

  const projects: Candidate[] = [];
  const siteDecisions = new Map<string, { published: Candidate[]; withheldCount: number }>();
  for (const [projectId, sites] of byProject) {
    const accumulator = emptyAccumulator();
    for (const site of sites) accumulate(accumulator, site.accumulator);
    projects.push({ id: projectId, accumulator });
    siteDecisions.set(projectId, applyComplementarySuppression(sites, minimumContributors));
  }

  const organisation = emptyAccumulator();
  for (const project of projects) accumulate(organisation, project.accumulator);
  // The organisation is a superset of every project, so if it cannot clear the
  // threshold nothing beneath it can either: the whole slice is withheld.
  if (organisation.contributors.size < minimumContributors) return [];

  const projectDecision = applyComplementarySuppression(projects, minimumContributors);

  const rows: ReleasedAggregate[] = [];
  for (const project of projectDecision.published) {
    const decision = siteDecisions.get(project.id);
    for (const site of decision?.published ?? []) {
      rows.push(toRow(monthStart, metricVersion, metricKey, 'site', project.id, site.id, null, site.accumulator));
    }
    rows.push(toRow(
      monthStart, metricVersion, metricKey, 'project', project.id, null,
      (decision?.withheldCount ?? 0) > 0 ? 'site' : null,
      project.accumulator,
    ));
  }
  // A withheld project publishes no site rows either: its sites would rebuild it.
  rows.push(toRow(
    monthStart, metricVersion, metricKey, 'organisation', null, null,
    projectDecision.withheldCount > 0 ? 'project' : null,
    organisation,
  ));
  return rows;
}

const LEVEL_ORDER: Record<AggregateDimensionLevel, number> = { site: 0, project: 1, organisation: 2 };

/**
 * Releases every group that may be published, generalizing or withholding the
 * rest. Returns rows in a stable order so a re-run is byte-identical.
 */
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

  const rows: ReleasedAggregate[] = [];
  for (const [key, slice] of slices) {
    const [monthStart, metricVersion, metricKey] = key.split(' ') as [string, string, OperationsMetricKey];
    rows.push(...releaseSlice(monthStart, Number(metricVersion), metricKey, slice, minimumContributors));
  }

  return rows.sort(
    (a, b) => a.monthStart.localeCompare(b.monthStart)
      || a.metricKey.localeCompare(b.metricKey)
      || LEVEL_ORDER[a.dimensionLevel] - LEVEL_ORDER[b.dimensionLevel]
      || (a.dimensionProjectId ?? '').localeCompare(b.dimensionProjectId ?? '')
      || (a.dimensionSiteId ?? '').localeCompare(b.dimensionSiteId ?? ''),
  );
}

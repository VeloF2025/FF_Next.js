/**
 * Rolling site-months up into the scopes a release decision is made for.
 *
 * A cell is one (month, version, level, dimension) with every variable the tier
 * rule reasons about: metric keys as counted, and the internal variables —
 * the two denominator tallies and the subset complements — carried alongside.
 *
 * Contributors UNION and never add, at every level and for every variable. That
 * is the whole reason a cell has to be built rather than summed from its
 * children's counts: one person working two sites is one person in the project's
 * support, and a rule that added the counts would think there were two.
 *
 * `buildCell` takes an arbitrary set of site-months rather than a fixed
 * hierarchy, because the organisation rule needs a cell that does not exist in
 * the hierarchy at all: the aggregate of whichever projects are not publishing.
 *
 * Pure: no SQL, no clock, no configuration lookup.
 */
import type { AggregateDimensionLevel } from './aggregateSchema';
import type { CalculatedMetricGroup } from './facts';
import type { CalculatedSiteMonth } from './metricCalculator';
import type { DurationHistogram } from './types';

export interface Accumulator {
  numerator: number;
  denominator: number | null;
  histogram: DurationHistogram | null;
  contributors: Set<string>;
}

export interface Cell {
  monthStart: string;
  metricVersion: number;
  level: AggregateDimensionLevel;
  projectId: string | null;
  /** Metric keys and internal variables alike. */
  values: Map<string, Accumulator>;
}

const emptyAccumulator = (): Accumulator => ({ numerator: 0, denominator: null, histogram: null, contributors: new Set() });

/** Adds `source` into `target` in place. Contributors union; they never add. */
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

/** One cell over exactly these site-months. */
export function buildCell(
  siteMonths: readonly CalculatedSiteMonth[],
  monthStart: string,
  metricVersion: number,
  level: AggregateDimensionLevel,
  projectId: string | null,
): Cell {
  const cell: Cell = { monthStart, metricVersion, level, projectId, values: new Map() };
  const addInto = (variable: string, source: Accumulator): void => {
    const target = cell.values.get(variable) ?? emptyAccumulator();
    cell.values.set(variable, target);
    accumulate(target, source);
  };
  for (const siteMonth of siteMonths) {
    for (const group of siteMonth.groups) addInto(group.metricKey, accumulatorFrom(group));
    for (const [variable, contributors] of siteMonth.internalSupport) {
      addInto(variable, { ...emptyAccumulator(), contributors: new Set(contributors) });
    }
  }
  return cell;
}

export const supportSize = (cell: Cell, variable: string): number =>
  cell.values.get(variable)?.contributors.size ?? 0;

export interface MonthScope {
  monthStart: string;
  metricVersion: number;
  /** Site-months by project id, for the month this scope covers. */
  byProject: Map<string, CalculatedSiteMonth[]>;
}

/** The site-months grouped by month and version, then by project. */
export function monthScopes(siteMonths: readonly CalculatedSiteMonth[]): MonthScope[] {
  const scopes = new Map<string, MonthScope>();
  for (const siteMonth of siteMonths) {
    const id = `${siteMonth.monthStart}|${siteMonth.metricVersion}`;
    const scope = scopes.get(id)
      ?? { monthStart: siteMonth.monthStart, metricVersion: siteMonth.metricVersion, byProject: new Map() };
    scopes.set(id, scope);
    scope.byProject.set(siteMonth.projectId, [...(scope.byProject.get(siteMonth.projectId) ?? []), siteMonth]);
  }
  return [...scopes.values()];
}

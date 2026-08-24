/**
 * Facts to per-site monthly metrics. Pure: no SQL, no clock, no configuration.
 *
 * Two rules shape everything below.
 *
 * A ratio's denominator is always the population the numerator was drawn FROM,
 * never a loosely related total. The aggregate table enforces
 * `numerator <= denominator`, so picking the convenient denominator instead of
 * the correct one does not produce a slightly wrong percentage - it produces a
 * failed 01:00 run. Incident counts therefore have NO denominator: several
 * incidents can land on one staff-day, so incidents-over-days is not a ratio.
 * The rate is divided at query time against `presence.scheduled_days`.
 *
 * Vehicle-only evidence is its own presence state and is never added into
 * `presence.confirmed_days`. A vehicle at a site is not a person at a site.
 *
 * Every group emits the complete metric set, zeros included, so a month's
 * coverage can be checked by counting rows rather than by guessing which
 * metrics "should" have been produced.
 */
import {
  DURATION_BUCKET_COLUMNS,
  OPERATIONS_METRIC_KEYS,
  TIMING_METRIC_KEYS,
} from './aggregateSchema';
import type { CalculatedMetricGroup, OperationsFact } from './facts';
import {
  INCIDENT_TOTAL, METRIC_SUBSETS, OUTCOME_TOTAL, denominatorKeyFor, restIdOf,
} from './metricRelations';
import type { Tally } from './metricTally';
import { applyFact, emptyTally } from './metricTally';

/** `YYYY-MM-DD` to the first of its month. The date is already SAST. */
function monthStartOf(workDate: string): string {
  return `${workDate.slice(0, 7)}-01`;
}

/**
 * The people a metric is actually about - and nobody else.
 *
 * An earlier version handed a zero-support metric the site ROSTER so that true
 * zeros stayed publishable, and re-opened the leak it was written alongside:
 * parent rows union their children's sets, so a real support of ONE at one site
 * merged with the rosters of people who contributed nothing at the others,
 * inflating 1 to 9 and defeating the organisation-level guard.
 *
 * So the set is the support, always, and an empty support stays empty.
 * `contributor_count` means one thing on every row at every level: how many
 * distinct people this number is about.
 */
function anonymitySetFor(tally: Tally, metricKey: string): Set<string> {
  return new Set(tally.contributorsByMetric.get(metricKey) ?? []);
}

const TIMING_KEYS = new Set<string>(TIMING_METRIC_KEYS);

function toGroups(tally: Tally, metricVersion: number): CalculatedMetricGroup[] {
  return OPERATIONS_METRIC_KEYS.map((metricKey) => {
    const denominatorKey = denominatorKeyFor(metricKey);
    const isTiming = TIMING_KEYS.has(metricKey);
    return {
      monthStart: tally.monthStart,
      metricVersion,
      projectId: tally.projectId,
      operationalSiteId: tally.operationalSiteId,
      metricKey,
      numerator: tally.counts.get(metricKey) ?? 0,
      denominator: isTiming || denominatorKey === null
        ? null
        : tally.counts.get(denominatorKey) ?? 0,
      histogram: isTiming
        ? tally.histograms.get(metricKey)
          ?? { sampleCount: 0, sumSeconds: 0, buckets: DURATION_BUCKET_COLUMNS.map(() => 0) }
        : null,
      contributors: anonymitySetFor(tally, metricKey),
    };
  });
}

/**
 * One site-month, with the internal variables the release rule needs. The two
 * denominator tallies and the subset complements are never rows — no metric key
 * could hold them — but their supports decide what may be published, so they
 * travel beside the groups.
 */
export interface CalculatedSiteMonth {
  monthStart: string;
  metricVersion: number;
  projectId: string;
  operationalSiteId: string;
  groups: readonly CalculatedMetricGroup[];
  internalSupport: ReadonlyMap<string, ReadonlySet<string>>;
}

const INTERNAL_VARIABLES = [INCIDENT_TOTAL, OUTCOME_TOTAL, ...METRIC_SUBSETS.map(restIdOf)];

/**
 * Calculates every metric for every site-month the facts touch.
 *
 * Site-months still carry contributor identities; `releaseAnonymousGroups` in
 * `./suppression` is what strips them, and nothing may be persisted before it
 * has run.
 */
export function calculateMonthly(
  facts: readonly OperationsFact[],
  metricVersion: number,
): CalculatedSiteMonth[] {
  const tallies = new Map<string, Tally>();

  for (const fact of facts) {
    const monthStart = monthStartOf(fact.workDate);
    const { projectId, operationalSiteId } = fact.dimension;
    const key = `${monthStart}|${projectId}|${operationalSiteId}`;
    const tally = tallies.get(key) ?? emptyTally(monthStart, projectId, operationalSiteId);
    tallies.set(key, tally);
    applyFact(tally, fact);
  }

  return [...tallies.values()].map((tally) => ({
    monthStart: tally.monthStart,
    metricVersion,
    projectId: tally.projectId,
    operationalSiteId: tally.operationalSiteId,
    groups: toGroups(tally, metricVersion),
    internalSupport: new Map(
      INTERNAL_VARIABLES.map((variable) => [variable, anonymitySetFor(tally, variable)]),
    ),
  }));
}

/** The groups alone, for callers that do not make a release decision. */
export function calculateMonthlyMetrics(
  facts: readonly OperationsFact[],
  metricVersion: number,
): CalculatedMetricGroup[] {
  return calculateMonthly(facts, metricVersion).flatMap((siteMonth) => siteMonth.groups);
}

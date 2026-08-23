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
  DURATION_BUCKET_BOUNDS,
  DURATION_BUCKET_COLUMNS,
  OPERATIONS_METRIC_KEYS,
  TIMING_METRIC_KEYS,
} from './aggregateSchema';
import type { OperationsMetricKey } from './aggregateSchema';
import type { CalculatedMetricGroup, IncidentFact, OperationsFact } from './facts';

/** Running totals for one site-month, before they are shaped into groups. */
interface Tally {
  monthStart: string;
  projectId: string;
  operationalSiteId: string;
  /**
   * Keyed by metric key, plus the two internal denominator tallies
   * (`incident.total`, `outcome.reviewed_total`) which are counted but never
   * emitted - hence `string` rather than `OperationsMetricKey`.
   */
  counts: Map<string, number>;
  histograms: Map<string, { sampleCount: number; sumSeconds: number; buckets: number[] }>;
  /**
   * Who actually contributed to EACH metric - its support.
   *
   * This is the anonymity set of the row that metric produces, and it is not
   * the site roster. A site of eight people where one had an accident has a
   * support of ONE for `incident.accident_sos` and for every timing metric that
   * incident fed; publishing those under the roster's eight would claim a
   * protection that does not exist, and `sum_seconds` with a single sample IS
   * that person's exact duration.
   */
  contributorsByMetric: Map<string, Set<string>>;
  /**
   * Everyone seen at this site-month, used ONLY as the anonymity set for a
   * metric whose support is zero. A true zero describes nobody in particular,
   * so it is safe to publish, and publishing it keeps every group's metric set
   * complete for coverage checking.
   */
  roster: Set<string>;
}

/** `YYYY-MM-DD` to the first of its month. The date is already SAST. */
function monthStartOf(workDate: string): string {
  return `${workDate.slice(0, 7)}-01`;
}

function emptyTally(monthStart: string, projectId: string, operationalSiteId: string): Tally {
  return {
    monthStart,
    projectId,
    operationalSiteId,
    counts: new Map(),
    histograms: new Map(),
    contributorsByMetric: new Map(),
    roster: new Set(),
  };
}

/** Records `by` against a metric, and credits the people it is about. */
function bump(tally: Tally, metricKey: string, contributors: readonly string[], by = 1): void {
  tally.counts.set(metricKey, (tally.counts.get(metricKey) ?? 0) + by);
  support(tally, metricKey, contributors);
}

/** Credits people to a metric's support without changing its numerator. */
function support(tally: Tally, metricKey: string, contributors: readonly string[]): void {
  const set = tally.contributorsByMetric.get(metricKey) ?? new Set<string>();
  tally.contributorsByMetric.set(metricKey, set);
  for (const contributor of contributors) set.add(contributor);
}

/**
 * Adds one duration to a metric's histogram.
 *
 * A bucket owns its upper bound inclusively, matching the column names
 * (`bucket_0_300` then `bucket_301_900`); anything past the last bound lands in
 * the overflow bucket. Storing counts rather than durations is what lets a
 * median stay estimable after the underlying incident has been purged.
 */
function observe(
  tally: Tally, metricKey: string, seconds: number | null, contributors: readonly string[],
): void {
  const histogram = tally.histograms.get(metricKey)
    ?? { sampleCount: 0, sumSeconds: 0, buckets: DURATION_BUCKET_COLUMNS.map(() => 0) };
  tally.histograms.set(metricKey, histogram);
  // A negative elapsed time is not a measurement, it is contradictory source
  // data, and `sum_seconds >= 0` is a CHECK on the aggregate table -- so
  // counting one would fail the whole month rather than skew an average. The
  // incident query is written so this cannot arise; this is the second line of
  // defence, because the cost of being wrong is a nightly run that never
  // recovers on its own.
  if (seconds === null || seconds < 0) return;

  let index = DURATION_BUCKET_BOUNDS.findIndex((bound) => seconds <= bound);
  if (index === -1) index = DURATION_BUCKET_COLUMNS.length - 1;
  histogram.sampleCount += 1;
  histogram.sumSeconds += seconds;
  histogram.buckets[index] = (histogram.buckets[index] ?? 0) + 1;
  // Only a MEASURED duration credits support. An incident that never reached
  // this transition contributes nothing to the histogram and must not enlarge
  // the group the histogram claims to describe.
  support(tally, metricKey, contributors);
}

function applyIncident(tally: Tally, fact: IncidentFact): void {
  const who = [fact.contributorKey];
  bump(tally, `incident.${fact.incidentType}`, who);
  if (fact.outcome !== null) {
    bump(tally, OUTCOME_DENOMINATOR, who);
    bump(tally, `outcome.${fact.outcome}`, who);
  }
  bump(tally, INCIDENT_DENOMINATOR, who);

  observe(tally, 'timing.acknowledgement', fact.acknowledgementSeconds, who);
  observe(tally, 'timing.review_start', fact.reviewStartSeconds, who);
  observe(tally, 'timing.resolution', fact.resolutionSeconds, who);
  observe(tally, 'timing.driver_response', fact.driverResponseSeconds, who);

  // Every response is counted only against a request that was actually sent.
  // `input.requests_sent` is the denominator for both of the others, and the
  // aggregate table enforces `numerator <= denominator`, so gating on
  // `driverInputRequested` here makes that invariant structural rather than
  // something the fact query has to remember to preserve. An unsolicited
  // submission is real and permitted, but it is not a response to a request
  // and there is no metric key in migration 518's closed set that could hold
  // it -- so it is counted nowhere rather than counted wrongly.
  if (fact.driverInputRequested) {
    bump(tally, 'input.requests_sent', who);
    if (fact.driverInputResponded) bump(tally, 'input.responses_received', who);
    if (fact.driverInputOnTime) bump(tally, 'input.responses_on_time', who);
  }
  if (fact.evidenceAvailable) bump(tally, 'reliability.evidence_available', who);
  if (fact.isRecurrence) bump(tally, 'reliability.recurrence', who);
}

function applyFact(tally: Tally, fact: OperationsFact): void {
  switch (fact.kind) {
    case 'presence': {
      const who = [fact.contributorKey];
      tally.roster.add(fact.contributorKey);
      bump(tally, 'presence.scheduled_days', who);
      bump(tally, `presence.${fact.confirmation}_days`, who);
      return;
    }
    case 'incident':
      tally.roster.add(fact.contributorKey);
      applyIncident(tally, fact);
      return;
    case 'monitor_run':
      for (const key of fact.contributorKeys) tally.roster.add(key);
      bump(tally, 'reliability.monitor_runs_expected', fact.contributorKeys);
      if (fact.completed) bump(tally, 'reliability.monitor_runs_completed', fact.contributorKeys);
      return;
    case 'notification': {
      const who = [fact.contributorKey];
      tally.roster.add(fact.contributorKey);
      bump(tally, 'reliability.notifications_sent', who);
      if (fact.delivered) bump(tally, 'reliability.notifications_delivered', who);
      return;
    }
  }
}

/**
 * Counted only to serve as denominators. Neither is a publishable metric key,
 * so neither is ever emitted as a row.
 */
const INCIDENT_DENOMINATOR = 'incident.total';
const OUTCOME_DENOMINATOR = 'outcome.reviewed_total';

/**
 * The population each ratio divides by, as an internal tally key. A metric
 * absent from this map is a count, and is published with no denominator.
 */
const DENOMINATOR_OF: Partial<Record<OperationsMetricKey, string>> = {
  'presence.confirmed_days': 'presence.scheduled_days',
  'presence.unconfirmed_days': 'presence.scheduled_days',
  'presence.vehicle_only_days': 'presence.scheduled_days',
  'input.responses_received': 'input.requests_sent',
  'input.responses_on_time': 'input.requests_sent',
  'reliability.monitor_runs_completed': 'reliability.monitor_runs_expected',
  'reliability.notifications_delivered': 'reliability.notifications_sent',
  'reliability.evidence_available': INCIDENT_DENOMINATOR,
  'reliability.recurrence': INCIDENT_DENOMINATOR,
};

const TIMING_KEYS = new Set<string>(TIMING_METRIC_KEYS);

function denominatorKeyFor(metricKey: OperationsMetricKey): string | null {
  if (metricKey.startsWith('outcome.')) return OUTCOME_DENOMINATOR;
  return DENOMINATOR_OF[metricKey] ?? null;
}

/**
 * The group a metric's row describes, and therefore the set the anonymity
 * threshold is applied to downstream.
 *
 * A metric with real support is described by exactly the people who contributed
 * to it - never by the wider roster, which would overstate the protection. A
 * metric with NO support is a true zero: it describes nobody in particular, so
 * the roster is the honest anonymity set and the row is safe to publish.
 */
function anonymitySetFor(tally: Tally, metricKey: string): Set<string> {
  const measured = tally.contributorsByMetric.get(metricKey);
  if (measured && measured.size > 0) return new Set(measured);
  return new Set(tally.roster);
}

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
 * Calculates every metric for every site-month the facts touch.
 *
 * Groups still carry contributor identities; `releaseAnonymousGroups` in
 * `./suppression` is what strips them, and nothing may be persisted before it
 * has run.
 */
export function calculateMonthlyMetrics(
  facts: readonly OperationsFact[],
  metricVersion: number,
): CalculatedMetricGroup[] {
  const tallies = new Map<string, Tally>();

  for (const fact of facts) {
    const monthStart = monthStartOf(fact.workDate);
    const { projectId, operationalSiteId } = fact.dimension;
    const key = `${monthStart}|${projectId}|${operationalSiteId}`;
    const tally = tallies.get(key) ?? emptyTally(monthStart, projectId, operationalSiteId);
    tallies.set(key, tally);
    applyFact(tally, fact);
  }

  return [...tallies.values()].flatMap((tally) => toGroups(tally, metricVersion));
}

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
  contributors: Set<string>;
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
    contributors: new Set(),
  };
}

function bump(tally: Tally, metricKey: string, by = 1): void {
  tally.counts.set(metricKey, (tally.counts.get(metricKey) ?? 0) + by);
}

/**
 * Adds one duration to a metric's histogram.
 *
 * A bucket owns its upper bound inclusively, matching the column names
 * (`bucket_0_300` then `bucket_301_900`); anything past the last bound lands in
 * the overflow bucket. Storing counts rather than durations is what lets a
 * median stay estimable after the underlying incident has been purged.
 */
function observe(tally: Tally, metricKey: string, seconds: number | null): void {
  const histogram = tally.histograms.get(metricKey)
    ?? { sampleCount: 0, sumSeconds: 0, buckets: DURATION_BUCKET_COLUMNS.map(() => 0) };
  tally.histograms.set(metricKey, histogram);
  if (seconds === null) return;

  let index = DURATION_BUCKET_BOUNDS.findIndex((bound) => seconds <= bound);
  if (index === -1) index = DURATION_BUCKET_COLUMNS.length - 1;
  histogram.sampleCount += 1;
  histogram.sumSeconds += seconds;
  histogram.buckets[index] = (histogram.buckets[index] ?? 0) + 1;
}

function applyIncident(tally: Tally, fact: IncidentFact): void {
  bump(tally, `incident.${fact.incidentType}`);
  if (fact.outcome !== null) {
    bump(tally, OUTCOME_DENOMINATOR);
    bump(tally, `outcome.${fact.outcome}`);
  }
  bump(tally, INCIDENT_DENOMINATOR);

  observe(tally, 'timing.acknowledgement', fact.acknowledgementSeconds);
  observe(tally, 'timing.review_start', fact.reviewStartSeconds);
  observe(tally, 'timing.resolution', fact.resolutionSeconds);
  observe(tally, 'timing.driver_response', fact.driverResponseSeconds);

  if (fact.driverInputRequested) bump(tally, 'input.requests_sent');
  if (fact.driverInputResponded) bump(tally, 'input.responses_received');
  if (fact.driverInputOnTime) bump(tally, 'input.responses_on_time');
  if (fact.evidenceAvailable) bump(tally, 'reliability.evidence_available');
  if (fact.isRecurrence) bump(tally, 'reliability.recurrence');
}

function applyFact(tally: Tally, fact: OperationsFact): void {
  switch (fact.kind) {
    case 'presence':
      tally.contributors.add(fact.contributorKey);
      bump(tally, 'presence.scheduled_days');
      bump(tally, `presence.${fact.confirmation}_days`);
      return;
    case 'incident':
      tally.contributors.add(fact.contributorKey);
      applyIncident(tally, fact);
      return;
    case 'monitor_run':
      for (const key of fact.contributorKeys) tally.contributors.add(key);
      bump(tally, 'reliability.monitor_runs_expected');
      if (fact.completed) bump(tally, 'reliability.monitor_runs_completed');
      return;
    case 'notification':
      tally.contributors.add(fact.contributorKey);
      bump(tally, 'reliability.notifications_sent');
      if (fact.delivered) bump(tally, 'reliability.notifications_delivered');
      return;
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
      contributors: new Set(tally.contributors),
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

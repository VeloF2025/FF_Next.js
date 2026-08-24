/**
 * Counting facts into one site-month's running totals.
 *
 * Split from `metricCalculator.ts` so that file can stay about the shape of what
 * comes out. Everything here is the shape of what goes in: one fact at a time,
 * credited to the metrics it belongs to and to the people it is about.
 *
 * The complements are the part worth reading. A subset pair's difference —
 * requests nobody answered, notifications that failed, incidents nobody reviewed
 * — has people behind it and no metric key to carry it, and the release rule
 * turns on how many. Here is the only place it can be counted exactly, off the
 * same fact that counts the pair.
 */
import { DURATION_BUCKET_BOUNDS, DURATION_BUCKET_COLUMNS } from './aggregateSchema';
import type { IncidentFact, OperationsFact } from './facts';
import type { MetricSubset } from './metricRelations';
import { INCIDENT_TOTAL, METRIC_SUBSETS, OUTCOME_TOTAL, restIdOf } from './metricRelations';

/** Running totals for one site-month, before they are shaped into groups. */
export interface Tally {
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
   * Who actually contributed to EACH metric - its support, and never the site
   * roster. A site of eight where one person had an accident has a support of
   * ONE for `incident.accident_sos` and for every timing metric that incident
   * fed; counting those under the roster's eight would claim a protection that
   * does not exist.
   */
  contributorsByMetric: Map<string, Set<string>>;
}

export function emptyTally(monthStart: string, projectId: string, operationalSiteId: string): Tally {
  return {
    monthStart,
    projectId,
    operationalSiteId,
    counts: new Map(),
    histograms: new Map(),
    contributorsByMetric: new Map(),
  };
}

/** Records `by` against a metric, and credits the people it is about. */
export function bump(tally: Tally, metricKey: string, contributors: readonly string[], by = 1): void {
  tally.counts.set(metricKey, (tally.counts.get(metricKey) ?? 0) + by);
  support(tally, metricKey, contributors);
}

/**
 * Credits people to the COMPLEMENT of a subset pair.
 *
 * `input.requests_sent` minus `input.responses_received` is the requests nobody
 * answered: a real quantity, with a support of its own and no metric key to
 * carry it. The release rule turns on how many people that is, and the only
 * place it can be counted exactly is here, off the same fact that counts the
 * pair. Anything reconstructed later from the two contributor sets is a bound.
 */
export function rest(tally: Tally, subset: MetricSubset, contributors: readonly string[]): void {
  support(tally, restIdOf(subset), contributors);
}

export const REST_OF = new Map(METRIC_SUBSETS.map((subset) => [`${subset.whole}|${subset.part}`, subset]));

/** Fails loudly rather than counting a complement the model does not declare. */
export const restBetween = (whole: string, part: string): MetricSubset => {
  const subset = REST_OF.get(`${whole}|${part}`);
  if (!subset) throw new Error(`fleet metrics: no subset relation ${whole} - ${part}`);
  return subset;
};

/** Credits people to a metric's support without changing its numerator. */
export function support(tally: Tally, metricKey: string, contributors: readonly string[]): void {
  const set = tally.contributorsByMetric.get(metricKey) ?? new Set<string>();
  tally.contributorsByMetric.set(metricKey, set);
  for (const contributor of contributors) set.add(contributor);
}

/**
 * Adds one duration to a metric's histogram. A bucket owns its upper bound
 * inclusively, matching the column names (`bucket_0_300` then
 * `bucket_301_900`); anything past the last bound lands in the overflow bucket.
 * Storing counts rather than durations is what lets a median stay estimable
 * after the underlying incident has been purged — an INTERNAL capability now:
 * migration 527's view publishes no histogram column.
 */
export function observe(
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

export function applyIncident(tally: Tally, fact: IncidentFact): void {
  const who = [fact.contributorKey];
  bump(tally, `incident.${fact.incidentType}`, who);
  if (fact.outcome !== null) {
    bump(tally, OUTCOME_TOTAL, who);
    bump(tally, `outcome.${fact.outcome}`, who);
  }
  bump(tally, INCIDENT_TOTAL, who);

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
    // An on-time response is a RESPONSE. Gating it on `driverInputResponded`,
    // the way both are gated on `driverInputRequested`, makes
    // `responses_on_time <= responses_received` structural rather than something
    // the fact query must remember. The release rule asserts that nesting, so a
    // fact setting `onTime` without `responded` would put a relation in the
    // model the data did not obey — which is what the disclosure sweep found.
    const onTime = fact.driverInputResponded && fact.driverInputOnTime;
    if (fact.driverInputResponded) bump(tally, 'input.responses_received', who);
    else rest(tally, restBetween('input.requests_sent', 'input.responses_received'), who);
    if (onTime) bump(tally, 'input.responses_on_time', who);
    else rest(tally, restBetween('input.requests_sent', 'input.responses_on_time'), who);
    if (fact.driverInputResponded && !onTime) {
      rest(tally, restBetween('input.responses_received', 'input.responses_on_time'), who);
    }
  }
  if (fact.evidenceAvailable) bump(tally, 'reliability.evidence_available', who);
  else rest(tally, restBetween(INCIDENT_TOTAL, 'reliability.evidence_available'), who);
  if (fact.isRecurrence) bump(tally, 'reliability.recurrence', who);
  else rest(tally, restBetween(INCIDENT_TOTAL, 'reliability.recurrence'), who);
  if (fact.outcome === null) rest(tally, restBetween(INCIDENT_TOTAL, OUTCOME_TOTAL), who);
}

export function applyFact(tally: Tally, fact: OperationsFact): void {
  switch (fact.kind) {
    case 'presence': {
      const who = [fact.contributorKey];
      bump(tally, 'presence.scheduled_days', who);
      bump(tally, `presence.${fact.confirmation}_days`, who);
      return;
    }
    case 'incident':
      applyIncident(tally, fact);
      return;
    case 'monitor_run':
      bump(tally, 'reliability.monitor_runs_expected', fact.contributorKeys);
      if (fact.completed) bump(tally, 'reliability.monitor_runs_completed', fact.contributorKeys);
      else {
        rest(tally, restBetween('reliability.monitor_runs_expected', 'reliability.monitor_runs_completed'), fact.contributorKeys);
      }
      return;
    case 'notification': {
      const who = [fact.contributorKey];
      bump(tally, 'reliability.notifications_sent', who);
      if (fact.delivered) bump(tally, 'reliability.notifications_delivered', who);
      else rest(tally, restBetween('reliability.notifications_sent', 'reliability.notifications_delivered'), who);
      return;
    }
  }
}

/**
 * Which live facts a request may see, how few of them the database needs to
 * send to answer it, and which metrics the answer is entitled to report.
 *
 * The retained half derives its numbers from the same four fact kinds the
 * nightly job uses. Loading only some of them does not produce a smaller
 * answer: `calculateMonthlyMetrics` emits the complete metric set for every
 * site-month it sees, so a missing fact kind comes out as a confident zero —
 * `presence.scheduled_days: 0` for a site that was fully staffed.
 *
 * When a filter makes a fact kind inapplicable rather than absent, the metrics
 * that kind feeds are OMITTED from the response instead of reported as zero. A
 * request filtered to `op_type=late` has nothing to say about presence, and
 * saying "0 scheduled days" is a wrong answer where saying nothing is a
 * complete one.
 *
 * The filter rules and the SQL narrowing beside them describe the same
 * restriction; they are kept in one file so a filter added to one is visibly
 * missing from the other.
 */
import { shiftMonth } from './aggregationService';
import { PRESENCE_METRIC_KEYS } from './aggregateSchema';
import type { OperationsMetricKey } from './aggregateSchema';
import type { FactQueryScope } from './factNarrowing';
import type { IncidentFact, OperationsFact } from './facts';
import { loadIncidentFacts, loadNotificationFacts } from './incidentFactQueries';
import { loadMonitorRunFacts } from './monitorFactQueries';
import { hasRetainedOnlyFilter } from './operationsFilters';
import { loadPresenceFacts, loadProjectsWithOperationalSites } from './presenceFactQueries';
import type { OperationsFilters } from './types';

/**
 * How many months load at once.
 *
 * A month is four queries and, for presence, a roster evaluation per project
 * per day. Twelve months in flight at once is a burst an interactive request
 * has no business creating on a pool the whole application shares, so the fan
 * out is capped rather than left to `Promise.all` over the range.
 */
export const MONTH_LOAD_CONCURRENCY = 4;

/** `Promise.all` with a ceiling. Results stay in input order. */
async function mapWithLimit<T, R>(
  items: readonly T[], limit: number, run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next; index < items.length; index = next) {
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * The incident-shaped filters, which are exactly the set an aggregate cannot
 * honour — `hasRetainedOnlyFilter`. One definition, because they are one fact
 * about the data: these attributes belong to an individual incident, so neither
 * a monthly aggregate nor a presence fact carries them.
 */
const hasIncidentShapedFilter = hasRetainedOnlyFilter;

/** The metric keys no incident fact can produce, whatever the incidents say. */
const NON_INCIDENT_METRIC_KEYS: readonly OperationsMetricKey[] = [
  ...PRESENCE_METRIC_KEYS,
  'reliability.monitor_runs_expected', 'reliability.monitor_runs_completed',
  'reliability.notifications_sent', 'reliability.notifications_delivered',
];

/**
 * The keys this request must not report. `reliability.evidence_available` and
 * `reliability.recurrence` are deliberately absent: both are derived from
 * incidents, so an incident filter narrows them rather than invalidating them.
 */
export function omittedMetricKeys(filters: OperationsFilters): ReadonlySet<OperationsMetricKey> {
  return new Set(hasIncidentShapedFilter(filters) ? NON_INCIDENT_METRIC_KEYS : []);
}

/** The op_ filters that apply to a live fact. Group filters only — see below. */
export function factMatchesFilters(fact: OperationsFact, filters: OperationsFilters): boolean {
  if (filters.projectId !== undefined && fact.dimension.projectId !== filters.projectId) return false;
  if (filters.operationalSiteId !== undefined && fact.dimension.operationalSiteId !== filters.operationalSiteId) return false;
  if (fact.kind !== 'incident') {
    // A non-incident fact carries none of the incident attributes, so an
    // incident-shaped filter excludes it rather than passing it through: a
    // presence figure that ignored `op_type` would silently answer a wider
    // question than the cards beside it.
    return !hasIncidentShapedFilter(filters);
  }
  return incidentMatchesFilters(fact, filters);
}

function incidentMatchesFilters(fact: IncidentFact, filters: OperationsFilters): boolean {
  if (filters.incidentType !== undefined && fact.incidentType !== filters.incidentType) return false;
  if (filters.severity !== undefined && fact.severity !== filters.severity) return false;
  if (filters.outcome !== undefined && fact.outcome !== filters.outcome) return false;
  if (filters.staffId !== undefined && fact.contributorKey !== filters.staffId) return false;
  if (filters.vehicleId !== undefined && fact.vehicleId !== filters.vehicleId) return false;
  if (filters.evidenceAvailable !== undefined && fact.evidenceAvailable !== filters.evidenceAvailable) return false;
  return true;
}

/**
 * What the database can decide before a row is ever sent to Node.
 *
 * Every predicate here is also re-applied in JS below. That is deliberate: the
 * SQL narrowing exists to stop a company-wide month being scanned and shipped
 * only to be thrown away, while the JS filter remains the single definition of
 * what a fact must satisfy. Removing either would be a behaviour change; only
 * the second would be a correctness one.
 */
function factQueryScope(filters: OperationsFilters, allowedProjectIds: string[] | null): FactQueryScope {
  const scope: FactQueryScope = {};
  if (allowedProjectIds !== null) scope.projectIds = allowedProjectIds;
  if (filters.operationalSiteId !== undefined) scope.operationalSiteId = filters.operationalSiteId;
  if (filters.incidentType !== undefined) scope.incidentType = filters.incidentType;
  if (filters.severity !== undefined) scope.severity = filters.severity;
  if (filters.outcome !== undefined) scope.outcome = filters.outcome;
  if (filters.staffId !== undefined) scope.staffId = filters.staffId;
  if (filters.vehicleId !== undefined) scope.vehicleId = filters.vehicleId;
  return scope;
}

/** The projects presence is evaluated for: the allowed set, or every project with a site. */
async function presenceProjectsFor(allowedProjectIds: string[] | null): Promise<string[]> {
  return allowedProjectIds ?? loadProjectsWithOperationalSites();
}

export async function loadRetainedFacts(
  months: readonly string[], filters: OperationsFilters, allowedProjectIds: string[] | null,
): Promise<OperationsFact[]> {
  // A project list that is present and empty can only ever answer nothing, and
  // asking twelve months of SQL for nothing is still twelve scans.
  if (allowedProjectIds !== null && allowedProjectIds.length === 0) return [];
  const queryScope = factQueryScope(filters, allowedProjectIds);
  const incidentShaped = hasIncidentShapedFilter(filters);
  const presenceProjects = incidentShaped ? [] : await presenceProjectsFor(allowedProjectIds);

  const perMonth = await mapWithLimit(months, MONTH_LOAD_CONCURRENCY, async (monthStart) => {
    const nextMonthStart = shiftMonth(monthStart, 1);
    const [incidents, notifications, monitorRuns, presence] = await Promise.all([
      loadIncidentFacts(monthStart, nextMonthStart, queryScope),
      incidentShaped ? [] : loadNotificationFacts(monthStart, nextMonthStart, queryScope),
      incidentShaped ? [] : loadMonitorRunFacts(monthStart, nextMonthStart, queryScope),
      incidentShaped ? { facts: [] } : loadPresenceFacts(monthStart, presenceProjects),
    ]);
    return [...presence.facts, ...incidents, ...notifications, ...monitorRuns];
  });

  const permitted = allowedProjectIds === null ? null : new Set(allowedProjectIds);
  return perMonth.flat().filter((fact) => {
    // Scope first, filters second: a filter can only ever narrow what scope
    // already allows, never reach past it.
    if (permitted !== null && !permitted.has(fact.dimension.projectId)) return false;
    return factMatchesFilters(fact, filters);
  });
}

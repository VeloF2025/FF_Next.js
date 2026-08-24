/**
 * Which live facts a request may see, and how few of them the database needs to
 * send to answer it.
 *
 * The filter rules are the definition; the SQL narrowing beside them is an
 * optimisation over the same rules. They are kept in one file so a filter added
 * to one is visibly missing from the other.
 */
import { shiftMonth } from './aggregationService';
import type { IncidentFact, OperationsFact } from './facts';
import type { FactQueryScope } from './incidentFactQueries';
import { loadIncidentFacts, loadNotificationFacts } from './incidentFactQueries';
import type { OperationsFilters } from './types';

/**
 * The incident-shaped filters. A non-incident fact carries none of these
 * attributes, so any one of them being set means notifications cannot
 * contribute and are not worth loading.
 */
function hasIncidentShapedFilter(filters: OperationsFilters): boolean {
  return filters.incidentType !== undefined || filters.severity !== undefined
    || filters.outcome !== undefined || filters.staffId !== undefined
    || filters.vehicleId !== undefined || filters.evidenceAvailable !== undefined;
}

/** The op_ filters that apply to a live fact. Group filters only — see below. */
function factMatchesFilters(fact: OperationsFact, filters: OperationsFilters): boolean {
  if (filters.projectId !== undefined && fact.dimension.projectId !== filters.projectId) return false;
  if (filters.operationalSiteId !== undefined && fact.dimension.operationalSiteId !== filters.operationalSiteId) return false;
  if (fact.kind !== 'incident') {
    // A non-incident fact carries none of the incident attributes, so an
    // incident-shaped filter excludes it rather than passing it through: a
    // presence figure that ignored `op_type` would silently answer a wider
    // question than the cards beside it.
    return filters.incidentType === undefined && filters.severity === undefined
      && filters.outcome === undefined && filters.staffId === undefined
      && filters.vehicleId === undefined && filters.evidenceAvailable === undefined;
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

export async function loadRetainedFacts(
  months: readonly string[], filters: OperationsFilters, allowedProjectIds: string[] | null,
): Promise<OperationsFact[]> {
  // A project list that is present and empty can only ever answer nothing, and
  // asking twelve months of SQL for nothing is still twelve scans.
  if (allowedProjectIds !== null && allowedProjectIds.length === 0) return [];
  const queryScope = factQueryScope(filters, allowedProjectIds);
  const wantsNotifications = !hasIncidentShapedFilter(filters);

  const perMonth = await Promise.all(months.map(async (monthStart) => {
    const nextMonthStart = shiftMonth(monthStart, 1);
    const [incidents, notifications] = await Promise.all([
      loadIncidentFacts(monthStart, nextMonthStart, queryScope),
      wantsNotifications ? loadNotificationFacts(monthStart, nextMonthStart, queryScope) : [],
    ]);
    return [...incidents, ...notifications];
  }));

  const permitted = allowedProjectIds === null ? null : new Set(allowedProjectIds);
  return perMonth.flat().filter((fact) => {
    // Scope first, filters second: a filter can only ever narrow what scope
    // already allows, never reach past it.
    if (permitted !== null && !permitted.has(fact.dimension.projectId)) return false;
    return factMatchesFilters(fact, filters);
  });
}

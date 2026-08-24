/**
 * Who may see what, over which months — everything both operations read paths
 * settle before they diverge.
 *
 * The retention boundary lives here because it is the same question for both:
 * a month is either one whose identifiable detail still exists, or one whose
 * detail was purged and survives only as a released aggregate. Splitting a
 * range on that boundary in two places would eventually split it two ways.
 */
import { getEffectiveAnalyticsRetentionSettings } from './settingsRepository';
import { isProjectOwnedByScope, resolveIncidentScope } from '../reviewScope';
import type { IncidentScopeFilter } from '../reviewScope';
import { shiftMonth } from './aggregationService';
import type { AggregateDimensionRequest } from './operationsAggregateQueries';
import { hasRetainedOnlyFilter } from './operationsFilters';
import { listScopedProjectIds } from './operationsRunQueries';
import { sastMonthStart } from './sastDates';
import type { OperationsFilters } from './types';

export class OperationsAccessDeniedError extends Error {
  constructor(message: string) { super(message); this.name = 'OperationsAccessDeniedError'; }
}

export class OperationsFilterConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'OperationsFilterConflictError'; }
}

export interface OperationsViewer {
  userId: string;
  staffId: string | null;
  role: string;
}

export const DRILL_DOWN_PAGE_SIZE = 100;

/** First day of the month a `YYYY-MM-DD` calendar date falls in. */
function monthStartOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** Every month start from `start`'s month through `end`'s month, inclusive. */
export function monthsBetween(start: string, end: string): string[] {
  const months: string[] = [];
  let cursor = monthStartOf(start);
  const last = monthStartOf(end);
  while (cursor <= last) {
    months.push(cursor);
    cursor = shiftMonth(cursor, 1);
  }
  return months;
}

/**
 * Two project restrictions combined. `null` means "no list at all", which is
 * wider than an empty list: an empty list is the honest answer when a manager
 * filter and a project filter name disjoint sets, and it must not silently
 * become "everything".
 */
function intersectProjects(left: string[] | null, right: string[] | null): string[] | null {
  if (left === null) return right;
  if (right === null) return left;
  const permitted = new Set(right);
  return left.filter((id) => permitted.has(id));
}

export interface ResolvedRange {
  scope: IncidentScopeFilter;
  metricVersion: number;
  retainedDetailFrom: string;
  retainedMonths: string[];
  historicMonths: string[];
  /** The restricted viewer's own projects. Empty for an unrestricted viewer. */
  scopedProjectIds: Set<string>;
  /**
   * Every project this answer may draw on, or `null` when nothing narrows it.
   * Scope, `op_manager` and `op_project` all fold into this one list, so the
   * two halves of the response cannot disagree about who is included.
   */
  allowedProjectIds: string[] | null;
}

/**
 * The projects a named `op_manager` owns, by the same rule the viewer's own
 * scope uses. Only the user id is known here, which is why the staff half of
 * the predicate is bound null.
 */
async function projectsManagedBy(managerUserId: string): Promise<string[]> {
  return listScopedProjectIds({ unrestricted: false, pmUserId: managerUserId, pmStaffId: null });
}

/**
 * The scope check, the retention boundary, and the month split — everything both
 * entry points need before they diverge.
 */
export async function resolveRange(
  filters: OperationsFilters, viewer: OperationsViewer, now: string,
): Promise<ResolvedRange> {
  const scope = await resolveIncidentScope(viewer.userId, viewer.staffId, viewer.role, 'view');
  if (!scope) throw new OperationsAccessDeniedError('You cannot view Fleet operations analytics');
  if (filters.projectId !== undefined && !await isProjectOwnedByScope(scope, filters.projectId)) {
    throw new OperationsAccessDeniedError('You cannot view analytics for that project');
  }

  const policy = await getEffectiveAnalyticsRetentionSettings(now);
  // The boundary is a South African calendar month: between midnight and 02:00
  // SAST on the 1st, a UTC reading is still in the previous month and leaves a
  // month whose detail has already been purged classed as retained — which then
  // reports zero from facts that no longer exist.
  const retainedDetailFrom = shiftMonth(sastMonthStart(now), -policy.retentionMonths);
  const months = monthsBetween(filters.start, filters.end);

  const scopedProjectIds = scope.unrestricted ? [] : await listScopedProjectIds(scope);
  const managedByFilter = filters.managerUserId === undefined
    ? null
    : await projectsManagedBy(filters.managerUserId);
  const allowedProjectIds = intersectProjects(
    intersectProjects(scope.unrestricted ? null : scopedProjectIds, managedByFilter),
    filters.projectId === undefined ? null : [filters.projectId],
  );

  return {
    scope,
    metricVersion: policy.metricVersion,
    retainedDetailFrom,
    retainedMonths: months.filter((month) => month >= retainedDetailFrom),
    historicMonths: months.filter((month) => month < retainedDetailFrom),
    scopedProjectIds: new Set(scopedProjectIds),
    allowedProjectIds,
  };
}

/**
 * The one message both entry points give for a per-person or per-vehicle filter
 * that reaches past the retention boundary. It is shared rather than repeated
 * because a drill-down that refused the same request with different words would
 * read as a different rule.
 */
export function assertRetainedOnlyFiltersFit(filters: OperationsFilters, range: ResolvedRange): void {
  if (!hasRetainedOnlyFilter(filters) || range.historicMonths.length === 0) return;
  throw new OperationsFilterConflictError(
    `op_driver and op_vehicle only apply to months at or after ${range.retainedDetailFrom}, when the detail behind them still exists`,
  );
}

/**
 * Which aggregate rows the historic half may read, or `null` when it must read
 * none — an `op_project` the named manager does not own has no honest answer
 * other than nothing, and asking for the project's rows anyway would return
 * figures the filter was meant to exclude.
 */
export function aggregateRequestFor(
  filters: OperationsFilters, range: ResolvedRange,
): AggregateDimensionRequest | null {
  const base = { monthStarts: range.historicMonths, metricVersion: range.metricVersion };
  if (filters.operationalSiteId !== undefined) {
    return { ...base, operationalSiteId: filters.operationalSiteId };
  }
  if (filters.projectId !== undefined) {
    if (range.allowedProjectIds !== null && !range.allowedProjectIds.includes(filters.projectId)) return null;
    return { ...base, projectId: filters.projectId };
  }
  // Only an explicit op_manager reads by project list. A restricted viewer with
  // no manager filter keeps the EXISTS predicate, which is the same definition
  // of "a project I manage" the incident queue enforces.
  if (filters.managerUserId !== undefined) {
    return { ...base, projectIds: range.allowedProjectIds ?? [] };
  }
  return base;
}

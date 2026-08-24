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
import { resolveCutoffWorkDate } from '../retention/retentionService';
import { hasRetainedOnlyFilter, retainedOnlyFilterNames } from './operationsFilters';
import { listScopedProjectIds, projectIdForOperationalSite } from './operationsRunQueries';
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

/**
 * The first month whose detail is retained IN FULL.
 *
 * The purge works by DAY: `retentionService` deletes every incident with
 * `work_date` strictly older than `resolveCutoffWorkDate`, which on the 24th of
 * a month is the 24th of the month `retentionMonths` earlier. The month that
 * cutoff falls in is therefore HALF purged — its first twenty-three days are
 * gone and the rest survive.
 *
 * Deriving such a month live would report the surviving days as the whole
 * month: a confident, complete-looking figure that is missing most of its
 * input. So a month counts as retained only when its first day is at or after
 * the cutoff, and a half-purged month is read from the released aggregates,
 * which were written while all of its detail still existed.
 *
 * The cutoff is imported from the retention service rather than restated here.
 * Two definitions of the same boundary would agree until one of them changed.
 */
function firstFullyRetainedMonth(now: string, retentionMonths: number): string {
  const cutoff = resolveCutoffWorkDate(now, retentionMonths);
  const cutoffMonth = monthStartOf(cutoff);
  return cutoff === cutoffMonth ? cutoffMonth : shiftMonth(cutoffMonth, 1);
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
  // A site is reached through its project, so it is scope-checked the same way.
  // Answering an out-of-scope site with an empty chart would read as "nothing
  // happened there", which is a different and worse answer than "not yours".
  if (filters.operationalSiteId !== undefined) {
    const siteProjectId = await projectIdForOperationalSite(filters.operationalSiteId);
    if (siteProjectId === null || !await isProjectOwnedByScope(scope, siteProjectId)) {
      throw new OperationsAccessDeniedError('You cannot view analytics for that site');
    }
  }

  const policy = await getEffectiveAnalyticsRetentionSettings(now);
  // Conservative on purpose while `live_retention_enabled` is off: the purge is
  // reporting only, so an older month's detail is usually still there and a
  // drill-down could have answered it. Reading the policy boundary rather than
  // the surviving rows means the answer does not change on the day an operator
  // turns deletion on — and a month that reports `aggregate_only` today is one
  // that would genuinely have nothing to show tomorrow.
  const retainedDetailFrom = firstFullyRetainedMonth(now, policy.retentionMonths);
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
    `${retainedOnlyFilterNames(filters).join(', ')} only apply to months at or after ${range.retainedDetailFrom}, when the detail behind them still exists`,
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
    // Both, when both were given: a site read without its project would answer
    // from that site's own rows even when op_project named a different project.
    return filters.projectId === undefined
      ? { ...base, operationalSiteId: filters.operationalSiteId }
      : { ...base, operationalSiteId: filters.operationalSiteId, projectId: filters.projectId };
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

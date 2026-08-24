/**
 * Operations analytics (stage 8 task 7): the read path over the numbers stages
 * 2-5 produce.
 *
 * ## Why a month is read from one source or the other
 *
 * A month whose identifiable detail still exists is derived LIVE, from the same
 * facts and the same calculator the nightly job uses. A month whose detail has
 * been purged is read from the released aggregates. The boundary is the
 * effective retention policy, and the two sets never overlap — a month belongs
 * to exactly one of them, so nothing is counted twice.
 *
 * The retained half is deliberately NOT read from the aggregates, even though
 * the aggregates cover recent months too. Those rows are k-anonymised: a
 * manager of a three-person site would find their own current numbers withheld
 * from them by machinery meant to protect data that outlives the retention
 * window. The retained half carries no anonymity claim because it needs none —
 * access is already confined to the projects the viewer manages, and every
 * incident behind the number is one they can open in their own queue.
 *
 * The historic half keeps every suppression the aggregates were released
 * under, and says so through `generalized` and `suppressionNotices` rather
 * than quietly presenting a partial figure as a total.
 *
 * ## Why the same calculator
 *
 * A second derivation would be a second opinion. #2594 made the same call for
 * presence in the nightly job: a month-end aggregate that disagrees with what a
 * supervisor saw on the day is worse than either answer being wrong alone.
 */
import { getEffectiveAnalyticsRetentionSettings } from './settingsRepository';
import { isProjectOwnedByScope, resolveIncidentScope } from '../reviewScope';
import type { IncidentScopeFilter } from '../reviewScope';
import { shiftMonth } from './aggregationService';
import type { IncidentFact, OperationsFact } from './facts';
import { loadIncidentFacts, loadNotificationFacts } from './incidentFactQueries';
import { calculateMonthlyMetrics } from './metricCalculator';
import { readPublishedAggregates } from './operationsAggregateQueries';
import { hasRetainedOnlyFilter } from './operationsFilters';
import { foldToCards, upsertValue } from './operationsMetricValues';
import { latestAggregationRun, listScopedProjectIds } from './operationsRunQueries';
import type {
  OperationsAnalyticsResponse, OperationsDrillDownResponse,
  OperationsFilters, OperationsMetricValue,
} from './types';

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
function monthsBetween(start: string, end: string): string[] {
  const months: string[] = [];
  let cursor = monthStartOf(start);
  const last = monthStartOf(end);
  while (cursor <= last) {
    months.push(cursor);
    cursor = shiftMonth(cursor, 1);
  }
  return months;
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

async function loadRetainedFacts(
  months: readonly string[], filters: OperationsFilters, scopedProjectIds: ReadonlySet<string>,
  scope: IncidentScopeFilter,
): Promise<OperationsFact[]> {
  const perMonth = await Promise.all(months.map(async (monthStart) => {
    const nextMonthStart = shiftMonth(monthStart, 1);
    const [incidents, notifications] = await Promise.all([
      loadIncidentFacts(monthStart, nextMonthStart),
      loadNotificationFacts(monthStart, nextMonthStart),
    ]);
    return [...incidents, ...notifications];
  }));

  return perMonth.flat().filter((fact) => {
    // Scope first, filters second: a filter can only ever narrow what scope
    // already allows, never reach past it.
    if (!scope.unrestricted && !scopedProjectIds.has(fact.dimension.projectId)) return false;
    return factMatchesFilters(fact, filters);
  });
}

function valuesFromFacts(facts: readonly OperationsFact[], metricVersion: number): Map<string, OperationsMetricValue[]> {
  const byMonth = new Map<string, OperationsMetricValue[]>();
  for (const group of calculateMonthlyMetrics(facts, metricVersion)) {
    const values = byMonth.get(group.monthStart) ?? [];
    upsertValue(values, {
      metricKey: group.metricKey, numerator: group.numerator, denominator: group.denominator,
      histogram: group.histogram ? { ...group.histogram, buckets: [...group.histogram.buckets] } : null,
      // A live month is not generalized: it is the detail itself, not a stand-in
      // for a group too small to publish.
      generalized: false,
    });
    byMonth.set(group.monthStart, values);
  }
  return byMonth;
}

interface ResolvedRange {
  scope: IncidentScopeFilter;
  metricVersion: number;
  retainedDetailFrom: string;
  retainedMonths: string[];
  historicMonths: string[];
  scopedProjectIds: Set<string>;
}

/**
 * The scope check, the retention boundary, and the month split — everything both
 * entry points need before they diverge.
 */
async function resolveRange(
  filters: OperationsFilters, viewer: OperationsViewer, now: string,
): Promise<ResolvedRange> {
  const scope = await resolveIncidentScope(viewer.userId, viewer.staffId, viewer.role, 'view');
  if (!scope) throw new OperationsAccessDeniedError('You cannot view Fleet operations analytics');
  if (filters.projectId !== undefined && !await isProjectOwnedByScope(scope, filters.projectId)) {
    throw new OperationsAccessDeniedError('You cannot view analytics for that project');
  }

  const policy = await getEffectiveAnalyticsRetentionSettings(now);
  const retainedDetailFrom = shiftMonth(monthStartOf(now.slice(0, 10)), -policy.retentionMonths);
  const months = monthsBetween(filters.start, filters.end);

  return {
    scope,
    metricVersion: policy.metricVersion,
    retainedDetailFrom,
    retainedMonths: months.filter((month) => month >= retainedDetailFrom),
    historicMonths: months.filter((month) => month < retainedDetailFrom),
    scopedProjectIds: new Set(scope.unrestricted ? [] : await listScopedProjectIds(scope)),
  };
}

export async function getOperationsAnalytics(
  filters: OperationsFilters, viewer: OperationsViewer, now: string = new Date().toISOString(),
): Promise<OperationsAnalyticsResponse> {
  const range = await resolveRange(filters, viewer, now);

  // A per-person or per-vehicle filter cannot be honoured against aggregates,
  // and answering the retained half alone would silently drop the older months
  // from a range the caller asked about.
  if (hasRetainedOnlyFilter(filters) && range.historicMonths.length > 0) {
    throw new OperationsFilterConflictError(
      `op_driver and op_vehicle only apply to months at or after ${range.retainedDetailFrom}, when the detail behind them still exists`,
    );
  }

  const facts = await loadRetainedFacts(range.retainedMonths, filters, range.scopedProjectIds, range.scope);
  const retainedByMonth = valuesFromFacts(facts, range.metricVersion);

  const aggregateRequest = { monthStarts: range.historicMonths, metricVersion: range.metricVersion };
  const published = await readPublishedAggregates(
    filters.projectId === undefined && filters.operationalSiteId === undefined
      ? aggregateRequest
      : { ...aggregateRequest, ...(filters.projectId !== undefined ? { projectId: filters.projectId } : {}),
        ...(filters.operationalSiteId !== undefined ? { operationalSiteId: filters.operationalSiteId } : {}) },
    range.scope,
  );

  const historicByMonth = new Map<string, OperationsMetricValue[]>();
  for (const row of published) {
    const values = historicByMonth.get(row.monthStart) ?? [];
    upsertValue(values, { ...row });
    historicByMonth.set(row.monthStart, values);
  }

  const series = monthsBetween(filters.start, filters.end).map((monthStart) => ({
    monthStart,
    values: (retainedByMonth.get(monthStart) ?? historicByMonth.get(monthStart) ?? [])
      .slice()
      .sort((a, b) => a.metricKey.localeCompare(b.metricKey)),
  }));

  const suppressionNotices: string[] = [];
  if (published.some((row) => row.generalized)) {
    suppressionNotices.push(
      'Some months before the retention boundary report a wider group than you asked for, because the narrower one described too few people to publish.',
    );
  }
  if (range.historicMonths.length > 0 && published.length === 0) {
    suppressionNotices.push(
      'No published figures exist for the months before the retention boundary in this selection.',
    );
  }

  const run = await latestAggregationRun();
  return {
    filters,
    metricVersion: range.metricVersion,
    retainedDetailFrom: range.retainedDetailFrom,
    cards: foldToCards(series),
    series,
    suppressionNotices,
    freshness: { aggregatesThrough: run?.aggregatesThrough ?? null, lastRunStatus: run?.status ?? null },
  };
}

export interface DrillDownOptions { cursor?: string | null }

/**
 * The incidents behind a number — but only where they still exist.
 *
 * `aggregate_only` is not an error and not an empty answer: it returns the same
 * values the analytics response showed and says plainly that no identifiable
 * detail survives for those months. Returning an empty id list without the mode
 * would read as "nothing happened".
 */
export async function getOperationsDrillDown(
  filters: OperationsFilters, viewer: OperationsViewer,
  options: DrillDownOptions = {}, now: string = new Date().toISOString(),
): Promise<OperationsDrillDownResponse> {
  const range = await resolveRange(filters, viewer, now);

  if (range.retainedMonths.length === 0) {
    if (hasRetainedOnlyFilter(filters)) {
      throw new OperationsFilterConflictError(
        'op_driver and op_vehicle cannot be applied to months whose detail has been purged',
      );
    }
    const published = await readPublishedAggregates(
      { monthStarts: range.historicMonths, metricVersion: range.metricVersion,
        ...(filters.projectId !== undefined ? { projectId: filters.projectId } : {}),
        ...(filters.operationalSiteId !== undefined ? { operationalSiteId: filters.operationalSiteId } : {}) },
      range.scope,
    );
    const values = foldToCards([{ values: published.map((row) => ({ ...row })) }]);
    return { mode: 'aggregate_only', values, incidentIds: [], nextCursor: null };
  }

  const facts = await loadRetainedFacts(range.retainedMonths, filters, range.scopedProjectIds, range.scope);
  const values = foldToCards([...valuesFromFacts(facts, range.metricVersion).values()].map((v) => ({ values: v })));

  // Sorted so a cursor means the same thing on every request; the cursor is the
  // last id returned, which cannot drift the way an offset does when a month is
  // re-derived between pages.
  const ids = [...new Set(facts.filter((fact): fact is IncidentFact => fact.kind === 'incident')
    .map((fact) => fact.incidentId))].sort();
  const after = options.cursor ?? null;
  const remaining = after === null ? ids : ids.filter((id) => id > after);
  const page = remaining.slice(0, DRILL_DOWN_PAGE_SIZE);
  const nextCursor = remaining.length > page.length ? page[page.length - 1] ?? null : null;

  return { mode: 'retained_detail', values, incidentIds: page, nextCursor };
}


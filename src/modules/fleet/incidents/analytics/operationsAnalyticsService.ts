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
import type { IncidentFact, OperationsFact } from './facts';
import { calculateMonthlyMetrics } from './metricCalculator';
import type { PublishedAggregate } from './operationsAggregateQueries';
import { readPublishedAggregates } from './operationsAggregateQueries';
import { loadRetainedFacts } from './operationsFactSelection';
import { foldToCards, upsertValue } from './operationsMetricValues';
import { latestAggregationRun } from './operationsRunQueries';
import type { OperationsViewer, ResolvedRange } from './operationsScope';
import {
  DRILL_DOWN_PAGE_SIZE, OperationsFilterConflictError,
  aggregateRequestFor, assertRetainedOnlyFiltersFit, monthsBetween, resolveRange,
} from './operationsScope';
import type {
  OperationsAnalyticsResponse, OperationsDrillDownResponse,
  OperationsFilters, OperationsMetricValue,
} from './types';

// The routes and the export (task 8) import these from the service, which is
// the module they already depend on; scope resolution is an implementation
// detail of it rather than a second public entry point.
export {
  DRILL_DOWN_PAGE_SIZE, OperationsAccessDeniedError, OperationsFilterConflictError,
} from './operationsScope';
export type { OperationsViewer } from './operationsScope';

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

/**
 * A restricted viewer reading their own projects gets one row per project that
 * published, and a project withheld by suppression is simply absent — nothing
 * in the response distinguishes it from a project where nothing happened. The
 * total is then presented as complete when it is not, so it says so instead.
 *
 * Deliberately not phrased as "withheld": a project with no incidents at all in
 * those months is equally absent, and claiming suppression that did not happen
 * is its own kind of wrong answer.
 */
function missingProjectNotice(
  filters: OperationsFilters, range: ResolvedRange, published: readonly PublishedAggregate[],
): string | null {
  const readsManagedProjects = !range.scope.unrestricted
    && filters.projectId === undefined && filters.operationalSiteId === undefined
    && filters.managerUserId === undefined;
  if (!readsManagedProjects || range.historicMonths.length === 0) return null;
  const expected = range.scopedProjectIds.size;
  const covered = new Set(published
    .map((row) => row.dimensionProjectId)
    .filter((id): id is string => id !== null)).size;
  if (expected === 0 || covered >= expected) return null;
  return `Figures for the months before the retention boundary cover ${covered} of the ${expected} projects you manage; `
    + 'the rest published nothing for those months, either because nothing happened there or because the group '
    + 'described too few people to publish.';
}

export async function getOperationsAnalytics(
  filters: OperationsFilters, viewer: OperationsViewer, now: string = new Date().toISOString(),
): Promise<OperationsAnalyticsResponse> {
  const range = await resolveRange(filters, viewer, now);

  // A per-person or per-vehicle filter cannot be honoured against aggregates,
  // and answering the retained half alone would silently drop the older months
  // from a range the caller asked about.
  assertRetainedOnlyFiltersFit(filters, range);

  const facts = await loadRetainedFacts(range.retainedMonths, filters, range.allowedProjectIds);
  const retainedByMonth = valuesFromFacts(facts, range.metricVersion);

  const aggregateRequest = aggregateRequestFor(filters, range);
  const published = aggregateRequest === null
    ? []
    : await readPublishedAggregates(aggregateRequest, range.scope);

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
  const missing = missingProjectNotice(filters, range, published);
  if (missing !== null) suppressionNotices.push(missing);

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

  // The same rule the analytics endpoint applies, in the same words: a
  // drill-down that refused the identical request differently would read as a
  // different rule rather than the same one.
  assertRetainedOnlyFiltersFit(filters, range);

  // A range with detail on one side of the boundary and none on the other has
  // no single honest answer here. Analytics can merge the two sources because
  // it answers in totals; a drill-down answers in incident ids, and the purged
  // months have none — so the ids would silently describe part of the range
  // while the values beside them described all of it.
  if (range.retainedMonths.length > 0 && range.historicMonths.length > 0) {
    throw new OperationsFilterConflictError(
      `a drill-down covers one side of the retention boundary at a time, and ${range.retainedDetailFrom} splits this range; ask for months at or after it, or months before it`,
    );
  }

  if (range.retainedMonths.length === 0) {
    const aggregateRequest = aggregateRequestFor(filters, range);
    const published = aggregateRequest === null
      ? []
      : await readPublishedAggregates(aggregateRequest, range.scope);
    const values = foldToCards([{ values: published.map((row) => ({ ...row })) }]);
    return { mode: 'aggregate_only', values, incidentIds: [], nextCursor: null };
  }

  const facts = await loadRetainedFacts(range.retainedMonths, filters, range.allowedProjectIds);
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


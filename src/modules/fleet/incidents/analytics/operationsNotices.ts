/**
 * What the historic half could NOT tell you, said out loud.
 *
 * Every notice here exists because an absence is invisible in a number. A
 * component released below FULL contributes fewer rows, or none, and the total
 * above it still looks like a total — so the shortfall has to be named, per
 * month and per component, or a reader compares two figures that do not cover
 * the same ground.
 *
 * Pure: no SQL, no clock, no scope lookup.
 */
import type { OperationsFilters } from './types';
import type { MetricComponent } from './metricRelations';
import { METRIC_COMPONENTS } from './metricRelations';
import type { PublishedAggregate } from './operationsAggregateQueries';
import type { ResolvedRange } from './operationsScope';

/** What a component's rows say about the tier it was released at. */
type ComponentTier = 'full' | 'total_only' | 'none';

function tierOf(component: MetricComponent, keysPresent: ReadonlySet<string>): ComponentTier {
  const present = component.keys.filter((key) => keysPresent.has(key));
  if (present.length === component.keys.length) return 'full';
  if (present.length === 0) return 'none';
  return 'total_only';
}

/** The metric keys published for each historic month, month by month. */
function keysByMonth(published: readonly PublishedAggregate[]): Map<string, Set<string>> {
  const byMonth = new Map<string, Set<string>>();
  for (const row of published) {
    const keys = byMonth.get(row.monthStart) ?? new Set<string>();
    keys.add(row.metricKey);
    byMonth.set(row.monthStart, keys);
  }
  return byMonth;
}

/**
 * What each historic month failed to publish, component by component.
 *
 * Two tiers below FULL both have to be said out loud, and only one of them is
 * visible in the numbers:
 *
 * - **TOTAL_ONLY** hands back a root total with its members withheld. A reader
 *   sees a total with nothing under it.
 * - **NONE** hands back nothing at all, and a component rooted on an internal
 *   tally — incidents, whose root `incident.total` is no metric key — can only
 *   ever be FULL or NONE. That month simply has no incident row, and the card
 *   above it then sums fewer months than the range holds. Nothing in the
 *   figures distinguishes that from a month in which nothing happened, which is
 *   why it is named here and why every value carries `coverage`.
 *
 * Grouped per component rather than emitted per (month, component) pair: the
 * pairwise form is up to fifteen components times twelve months of near
 * identical sentences, and a notice list nobody reads is not a disclosure.
 * Every pair is still named — the component by its root, the months by date.
 */
export function releaseTierNotices(
  historicMonths: readonly string[], published: readonly PublishedAggregate[],
): string[] {
  if (historicMonths.length === 0) return [];
  const byMonth = keysByMonth(published);
  const notices: string[] = [];
  for (const component of METRIC_COMPONENTS) {
    const withheld: string[] = [];
    const partial: string[] = [];
    for (const monthStart of historicMonths) {
      const tier = tierOf(component, byMonth.get(monthStart) ?? new Set<string>());
      if (tier === 'none') withheld.push(monthStart);
      if (tier === 'total_only') partial.push(monthStart);
    }
    if (withheld.length > 0) {
      notices.push(`No figures were published for the ${component.root} group in ${withheld.join(', ')}; `
        + 'those months are missing from any total that covers them, rather than counted as zero.');
    }
    if (partial.length > 0) {
      notices.push(`The ${component.root} group reports a total without the figures behind it in ${partial.join(', ')}; `
        + 'the narrower groups described too few people to publish, so they are omitted rather than shown as zero.');
    }
  }
  return notices;
}

/**
 * A restricted viewer reading their own projects gets one row per project that
 * published, and a project withheld by suppression is simply absent — nothing
 * in the response distinguishes it from a project where nothing happened. The
 * total is then presented as complete when it is not, so it says so instead.
 *
 * Counted PER MONTH. Over the union of months, a project that published in
 * June and nothing in July looks fully covered, and July's total — short one
 * project — passes without a word.
 *
 * Deliberately not phrased as "withheld": a project with no incidents at all in
 * those months is equally absent, and claiming suppression that did not happen
 * is its own kind of wrong answer.
 */
export function missingProjectNotice(
  filters: OperationsFilters, range: ResolvedRange, published: readonly PublishedAggregate[],
): string | null {
  const readsManagedProjects = !range.scope.unrestricted
    && filters.projectId === undefined && filters.operationalSiteId === undefined
    && filters.managerUserId === undefined;
  if (!readsManagedProjects || range.historicMonths.length === 0) return null;
  const expected = range.scopedProjectIds.size;
  if (expected === 0) return null;

  const projectsByMonth = new Map<string, Set<string>>();
  for (const row of published) {
    if (row.dimensionProjectId === null) continue;
    const projects = projectsByMonth.get(row.monthStart) ?? new Set<string>();
    projects.add(row.dimensionProjectId);
    projectsByMonth.set(row.monthStart, projects);
  }

  const short = range.historicMonths
    .map((monthStart) => ({ monthStart, covered: projectsByMonth.get(monthStart)?.size ?? 0 }))
    .filter((month) => month.covered < expected);
  if (short.length === 0) return null;

  const detail = short.map((month) => `${month.monthStart} (${month.covered} of ${expected})`).join(', ');
  return `Figures before the retention boundary cover fewer than the ${expected} projects you manage in ${detail}; `
    + 'the rest published nothing for those months, either because nothing happened there or because the group '
    + 'described too few people to publish.';
}

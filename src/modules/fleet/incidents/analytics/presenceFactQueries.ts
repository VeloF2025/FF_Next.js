/**
 * The presence half of a month's facts, one roster day at a time.
 *
 * This deliberately reuses `getOperationalRosterStatus` - the same evaluation
 * the live roster screens run - rather than deriving presence from attendance
 * and GPS in new SQL. A second derivation would be a second opinion, and a
 * month-end aggregate that disagrees with what a supervisor saw on the day is
 * worse than either answer being wrong alone.
 *
 * The cost of that choice is honest and visible: the roster evaluator is
 * per-project and per-day, so a month is `projects x days` evaluations and a
 * three-month recalculation window is roughly ninety per project per nightly
 * run. If the 01:00 run starts running long, THIS is the thing to replace with
 * a set-based month query - and the replacement has to keep agreeing with the
 * live screens, which is the whole reason it was not written that way first.
 *
 * `asOf` is pinned to the end of each work date in SAST, never to "now". A
 * re-run of a past month must produce the same statuses, or every recalculation
 * would rewrite every row and the aggregate checksums would never settle.
 */
import { log } from '@/lib/logger';
import { query } from '@/lib/db-pool';
import { getOperationalRosterStatus } from '@/modules/fleet/operations/statusService';
import type { PresenceFact } from './facts';
import { presenceConfirmationFor } from './presenceClassification';
import { datesInMonth, endOfWorkDate } from './sastDates';

const MODULE = 'FleetAnalyticsPresenceFacts';

/** One roster page; large enough that a normal site is a single round trip. */
const ROSTER_PAGE_SIZE = 200;

/** Refuses to page forever if the evaluator ever reports a non-decreasing total. */
const MAX_ROSTER_PAGES = 50;

interface ProjectRow extends Record<string, unknown> {
  project_id: string;
}

/**
 * Projects that have at least one active operational site.
 *
 * A project without one cannot produce a site-dimensioned fact, so evaluating
 * its roster would cost a query per day and yield nothing.
 */
export async function loadProjectsWithOperationalSites(): Promise<string[]> {
  const rows = await query<ProjectRow>(
    `/* fleet-analytics-facts:projects */
     SELECT DISTINCT s.project_id
     FROM fleet_project_operational_sites s
     WHERE s.is_active = true AND s.project_id IS NOT NULL
     ORDER BY s.project_id`,
    [],
  );
  return rows.map((row) => row.project_id);
}


async function presenceForProjectDay(projectId: string, workDate: string): Promise<PresenceFact[]> {
  const asOf = endOfWorkDate(workDate);
  const facts: PresenceFact[] = [];

  for (let page = 1; page <= MAX_ROSTER_PAGES; page += 1) {
    const result = await getOperationalRosterStatus({
      projectId, workDate, asOf, page, limit: ROSTER_PAGE_SIZE,
    });

    for (const item of result.items) {
      // A roster entry with no resolved site has no dimension to belong to.
      if (!item.operationalSiteId || !item.projectId) continue;
      const confirmation = presenceConfirmationFor(item.status);
      if (confirmation === null) continue;
      facts.push({
        kind: 'presence',
        workDate,
        dimension: { projectId: item.projectId, operationalSiteId: item.operationalSiteId },
        contributorKey: item.staffId,
        confirmation,
      });
    }

    if (!result.hasMore) return facts;
    if (page === MAX_ROSTER_PAGES) {
      log.warn(
        '[fleet-analytics] roster paging hit its ceiling; the day is counted short',
        { projectId, workDate, pages: page },
        MODULE,
      );
    }
  }
  return facts;
}

/**
 * Presence facts for one month across every project with an operational site.
 *
 * A single project-day that throws is not allowed to lose the month: it is
 * logged and skipped, and the caller is told how many were skipped so the run
 * can be recorded as partial rather than as a clean success over incomplete
 * data.
 */
export async function loadPresenceFacts(
  monthStart: string,
  projectIds: readonly string[],
): Promise<{ facts: PresenceFact[]; skippedDays: number }> {
  const facts: PresenceFact[] = [];
  let skippedDays = 0;

  for (const projectId of projectIds) {
    for (const workDate of datesInMonth(monthStart)) {
      try {
        facts.push(...await presenceForProjectDay(projectId, workDate));
      } catch (error) {
        skippedDays += 1;
        log.warn(
          '[fleet-analytics] roster evaluation failed for a project-day; month will be partial',
          {
            projectId,
            workDate,
            error: error instanceof Error ? error.message : String(error),
          },
          MODULE,
        );
      }
    }
  }

  return { facts, skippedDays };
}

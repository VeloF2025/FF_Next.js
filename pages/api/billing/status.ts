/**
 * API Route: /api/billing/status
 *
 * Purpose: Return current billing health metrics per project (or all projects).
 *
 * Method: GET
 *
 * Query params:
 *   project - (optional) Filter to a single project name (exact ILIKE match)
 *
 * Metrics per project (all anchored to the LATEST billing week):
 *   currently_excluded  - DISTINCT dr_number in latest week's ft_billing_deductions
 *   pp_outstanding      - Pre-provisions not yet activated (oes_pp_data)
 *   recovered_this_month - DRs that were deducted 4 weeks ago but are NOT in
 *                          the current week's deductions (i.e., the issue was resolved)
 *
 * CRITICAL: "currently_excluded" counts DISTINCT dr_number from the LATEST week only.
 * Never sum deduction counts across multiple weeks.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';

const logger = createLogger('api/billing/status');

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectStatus {
  project: string;
  latest_week_ending: string | null;
  /**
   * Whole weeks this project's latest billing week trails the newest week in
   * `ft_weekly_billing` overall. 0 = current. >0 means every metric below is
   * anchored to a STALE week and is not comparable with the other projects.
   */
  weeks_behind: number;
  currently_excluded: number;
  pp_outstanding: number;
  recovered_this_month: number;
}

interface StatusResponse {
  projects: ProjectStatus[];
  /** Newest week present in ft_weekly_billing across ALL projects. */
  newest_week_ending: string | null;
  /**
   * Projects whose latest billing week trails `newest_week_ending`. Callers
   * that aggregate `totals` MUST surface this — a non-empty list means the
   * totals mix weeks and under-count the stale projects.
   */
  stale: { project: string; latest_week_ending: string | null; weeks_behind: number }[];
  totals: {
    currently_excluded: number;
    pp_outstanding: number;
    recovered_this_month: number;
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    const { project } = req.query;
    const projectFilter = typeof project === 'string' ? project.trim() : null;

    // ── Get distinct project list ─────────────────────────────────────────
    // Use only projects that have at least one billing week
    const projectsResult = await pool.query<{ project: string }>(
      `SELECT DISTINCT project
       FROM ft_weekly_billing
       ${projectFilter ? 'WHERE project ILIKE $1' : ''}
       ORDER BY project`,
      projectFilter ? [`%${projectFilter}%`] : []
    );

    const projects = projectsResult.rows.map(r => r.project);

    if (projects.length === 0) {
      const emptyResponse: StatusResponse = {
        projects: [],
        newest_week_ending: null,
        stale: [],
        totals: { currently_excluded: 0, pp_outstanding: 0, recovered_this_month: 0 },
      };
      return apiResponse.success(res, emptyResponse);
    }

    // ── Newest billing week across ALL projects ───────────────────────────
    // Deliberately NOT filtered by `projectFilter`: staleness is only
    // meaningful against the global frontier. Scoping this to the filtered
    // project would make every project look current when viewed alone.
    // ::text — `week_ending` is a `date` column and node-postgres would
    // otherwise hand back a Date parsed in server-local time (SAST), which
    // serializes back a day early.
    const newestResult = await pool.query<{ newest: string | null }>(
      `SELECT MAX(week_ending)::text AS newest FROM ft_weekly_billing`,
    );
    const newestWeekEnding = newestResult.rows[0]?.newest ?? null;

    // ── Compute metrics per project ───────────────────────────────────────
    const projectStatuses: ProjectStatus[] = await Promise.all(
      projects.map(proj => getProjectStatus(proj, newestWeekEnding))
    );

    const stale = projectStatuses
      .filter(ps => ps.weeks_behind > 0)
      .map(ps => ({
        project: ps.project,
        latest_week_ending: ps.latest_week_ending,
        weeks_behind: ps.weeks_behind,
      }));

    // ── Aggregate totals ──────────────────────────────────────────────────
    const totals = projectStatuses.reduce(
      (acc, ps) => ({
        currently_excluded: acc.currently_excluded + ps.currently_excluded,
        pp_outstanding: acc.pp_outstanding + ps.pp_outstanding,
        recovered_this_month: acc.recovered_this_month + ps.recovered_this_month,
      }),
      { currently_excluded: 0, pp_outstanding: 0, recovered_this_month: 0 }
    );

    logger.info('Billing status fetched', {
      projectCount: projectStatuses.length,
      newestWeekEnding,
      staleProjects: stale.map(s => `${s.project}@${s.latest_week_ending}`),
      totals,
    });

    const response: StatusResponse = {
      projects: projectStatuses,
      newest_week_ending: newestWeekEnding,
      stale,
      totals,
    };
    return apiResponse.success(res, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch billing status';
    logger.error('status GET failed', { error: message });
    return res.status(500).json({ success: false, error: message });
  }
}

// ─── Per-project Status Query ─────────────────────────────────────────────────

async function getProjectStatus(
  project: string,
  newestWeekEnding: string | null,
): Promise<ProjectStatus> {
  // ── Latest week_ending for this project ────────────────────────────────
  // ::text so the `date` column doesn't come back as a server-local Date
  // (see the newest-week query above) — this value is rendered to the user.
  const latestWeekResult = await pool.query<{ week_ending: string }>(
    `SELECT week_ending::text AS week_ending FROM ft_weekly_billing
     WHERE project = $1
     ORDER BY week_ending DESC
     LIMIT 1`,
    [project]
  );
  const latestWeekEnding = latestWeekResult.rows[0]?.week_ending ?? null;

  // ── Weeks behind the global frontier ───────────────────────────────────
  // Both values are 'YYYY-MM-DD' text, so Date.parse of an explicit Z instant
  // is timezone- and DST-safe.
  //
  // CEIL, not round. FT bills on a weekly cadence but nothing enforces it —
  // `ft_weekly_billing` has only UNIQUE(week_ending, project), no CHECK on
  // day-of-week or 7-day spacing. A backfill or correction could leave a gap
  // that isn't a multiple of 7, and Math.round would report a real 3-day gap
  // as 0 weeks behind, dropping the project out of `stale` (filtered on
  // > 0) — silently hiding exactly what this signal exists to surface.
  // Ceil means any gap at all reports as at least 1 week behind; for the
  // normal whole-week case it is identical to round.
  const msBehind =
    latestWeekEnding && newestWeekEnding
      ? Date.parse(`${newestWeekEnding}T00:00:00Z`) -
        Date.parse(`${latestWeekEnding}T00:00:00Z`)
      : 0;
  // Math.max clamps the impossible "ahead of the global newest" case to 0.
  const weeksBehind = Math.max(0, Math.ceil(msBehind / (7 * 24 * 60 * 60 * 1000)));

  // ── Currently excluded: DISTINCT dr_number from latest week only ────────
  // CRITICAL: anchored to latest week — never aggregate across weeks
  const excludedResult = await pool.query<{ count: string }>(
    `SELECT COUNT(DISTINCT fbd.dr_number) AS count
     FROM ft_billing_deductions fbd
     WHERE fbd.billing_week_id = (
       SELECT id FROM ft_weekly_billing
       WHERE project = $1
       ORDER BY week_ending DESC
       LIMIT 1
     )`,
    [project]
  );
  const currentlyExcluded = parseInt(excludedResult.rows[0]?.count ?? '0', 10);

  // ── PP outstanding: pre-provisions not yet resolved ──────────────────────
  const ppResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM oes_pp_data
     WHERE project ILIKE $1
       AND resolution_status != 'activated'
       -- a classified pre-provision has left the list (migration 524)
       AND exit_reason IS NULL`,
    [project]
  );
  const ppOutstanding = parseInt(ppResult.rows[0]?.count ?? '0', 10);

  // ── Recovered this month: DRs in deductions 4 weeks ago NOT in latest ───
  // A DR that was deducted 4 weeks ago but is no longer deducted now = resolved
  const recoveredResult = await pool.query<{ count: string }>(
    `WITH latest AS (
       SELECT id FROM ft_weekly_billing
       WHERE project = $1
       ORDER BY week_ending DESC
       LIMIT 1
     ),
     four_weeks_ago AS (
       SELECT id FROM ft_weekly_billing
       WHERE project = $1
       ORDER BY week_ending DESC
       OFFSET 4
       LIMIT 1
     )
     SELECT COUNT(DISTINCT old_fbd.dr_number) AS count
     FROM ft_billing_deductions old_fbd
     JOIN four_weeks_ago fwa ON old_fbd.billing_week_id = fwa.id
     LEFT JOIN ft_billing_deductions cur_fbd
       ON cur_fbd.dr_number = old_fbd.dr_number
      AND cur_fbd.billing_week_id = (SELECT id FROM latest)
     WHERE cur_fbd.id IS NULL`,
    [project]
  );
  const recoveredThisMonth = parseInt(recoveredResult.rows[0]?.count ?? '0', 10);

  return {
    project,
    latest_week_ending: latestWeekEnding,
    weeks_behind: weeksBehind,
    currently_excluded: currentlyExcluded,
    pp_outstanding: ppOutstanding,
    recovered_this_month: recoveredThisMonth,
  };
}

export default withAuth(handler);

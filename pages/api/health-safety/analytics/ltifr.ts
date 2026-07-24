/**
 * H&S Injury-Rate Analytics (goal Phase 6, §7.6)
 *
 * GET /api/health-safety/analytics/ltifr?project_id=&year=
 *
 * LTIFR / DIFR / TRIFR computed in SQL (§4.7) from man-hours + classified
 * injuries, using the 200,000-hour base. Returns overall totals, a per-project
 * roll-up, and a per-month trend.
 *
 *   LTIFR = (lost_time + fatality)                                   × 200000 / hours
 *   DIFR  = (lost_time + fatality + restricted_work)                × 200000 / hours
 *   TRIFR = (lost_time + fatality + restricted_work + medical_trt)  × 200000 / hours
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : null;
    const year = typeof req.query.year === 'string' && /^\d{4}$/.test(req.query.year) ? parseInt(req.query.year, 10) : null;

    // Overall totals over the filtered set.
    const [totals] = await sql`
      WITH hrs AS (
        SELECT COALESCE(SUM(hours_worked), 0) AS hours
        FROM hs_man_hours
        WHERE (${projectId}::uuid IS NULL OR project_id = ${projectId}::uuid)
          AND (${year}::int IS NULL OR period_year = ${year}::int)
      ),
      inj AS (
        SELECT
          COUNT(*) FILTER (WHERE classification IN ('lost_time','fatality'))::int AS lti,
          COUNT(*) FILTER (WHERE classification IN ('lost_time','fatality','restricted_work'))::int AS disabling,
          COUNT(*) FILTER (WHERE classification IN ('lost_time','fatality','restricted_work','medical_treatment'))::int AS recordable,
          COALESCE(SUM(days_lost), 0)::int AS days_lost
        FROM hs_injuries
        WHERE (${projectId}::uuid IS NULL OR project_id = ${projectId}::uuid)
          AND (${year}::int IS NULL OR EXTRACT(YEAR FROM injury_date) = ${year}::int)
      )
      SELECT hrs.hours::float AS hours_worked, inj.lti AS lost_time_injuries,
             inj.disabling AS disabling_injuries, inj.recordable AS recordable_injuries, inj.days_lost,
             CASE WHEN hrs.hours > 0 THEN ROUND(inj.lti * 200000.0 / hrs.hours, 2) END AS ltifr,
             CASE WHEN hrs.hours > 0 THEN ROUND(inj.disabling * 200000.0 / hrs.hours, 2) END AS difr,
             CASE WHEN hrs.hours > 0 THEN ROUND(inj.recordable * 200000.0 / hrs.hours, 2) END AS trifr
      FROM hrs, inj
    `;

    // Per-month trend (full outer join hours × injuries on year+month).
    const trend = await sql`
      WITH hrs AS (
        SELECT period_year AS y, period_month AS m, SUM(hours_worked) AS hours
        FROM hs_man_hours
        WHERE (${projectId}::uuid IS NULL OR project_id = ${projectId}::uuid)
          AND (${year}::int IS NULL OR period_year = ${year}::int)
        GROUP BY period_year, period_month
      ),
      inj AS (
        SELECT EXTRACT(YEAR FROM injury_date)::int AS y, EXTRACT(MONTH FROM injury_date)::int AS m,
          COUNT(*) FILTER (WHERE classification IN ('lost_time','fatality'))::int AS lti,
          COUNT(*) FILTER (WHERE classification IN ('lost_time','fatality','restricted_work'))::int AS disabling,
          COUNT(*) FILTER (WHERE classification IN ('lost_time','fatality','restricted_work','medical_treatment'))::int AS recordable
        FROM hs_injuries
        WHERE (${projectId}::uuid IS NULL OR project_id = ${projectId}::uuid)
          AND (${year}::int IS NULL OR EXTRACT(YEAR FROM injury_date) = ${year}::int)
        GROUP BY 1, 2
      )
      SELECT COALESCE(hrs.y, inj.y) AS year, COALESCE(hrs.m, inj.m) AS month,
             COALESCE(hrs.hours, 0)::float AS hours_worked,
             COALESCE(inj.lti, 0) AS lost_time_injuries,
             COALESCE(inj.recordable, 0) AS recordable_injuries,
             CASE WHEN COALESCE(hrs.hours,0) > 0 THEN ROUND(COALESCE(inj.lti,0) * 200000.0 / hrs.hours, 2) END AS ltifr,
             CASE WHEN COALESCE(hrs.hours,0) > 0 THEN ROUND(COALESCE(inj.recordable,0) * 200000.0 / hrs.hours, 2) END AS trifr
      FROM hrs FULL OUTER JOIN inj ON hrs.y = inj.y AND hrs.m = inj.m
      ORDER BY year, month
    `;

    // Per-project roll-up (only meaningful when not already filtered to one project).
    const byProject = await sql`
      WITH hrs AS (
        SELECT project_id, SUM(hours_worked) AS hours FROM hs_man_hours
        WHERE (${year}::int IS NULL OR period_year = ${year}::int) GROUP BY project_id
      ),
      inj AS (
        SELECT project_id,
          COUNT(*) FILTER (WHERE classification IN ('lost_time','fatality'))::int AS lti,
          COUNT(*) FILTER (WHERE classification IN ('lost_time','fatality','restricted_work','medical_treatment'))::int AS recordable
        FROM hs_injuries
        WHERE (${year}::int IS NULL OR EXTRACT(YEAR FROM injury_date) = ${year}::int) GROUP BY project_id
      ),
      merged AS (
        -- NULL-safe join: the company-wide bucket has project_id NULL, and
        -- NULL = NULL is unknown in SQL, so a plain equi-join would split it
        -- into two rows. IS NOT DISTINCT FROM isn't allowed as a sole FULL JOIN
        -- condition, so key on a COALESCE'd sentinel (hash-joinable).
        SELECT COALESCE(hrs.project_id, inj.project_id) AS project_id,
               COALESCE(hrs.hours, 0) AS hours, COALESCE(inj.lti, 0) AS lti, COALESCE(inj.recordable, 0) AS recordable
        FROM hrs FULL OUTER JOIN inj
          ON COALESCE(hrs.project_id::text, '') = COALESCE(inj.project_id::text, '')
      )
      SELECT m.project_id, p.project_name, m.hours::float AS hours_worked, m.lti AS lost_time_injuries, m.recordable AS recordable_injuries,
             CASE WHEN m.hours > 0 THEN ROUND(m.lti * 200000.0 / m.hours, 2) END AS ltifr,
             CASE WHEN m.hours > 0 THEN ROUND(m.recordable * 200000.0 / m.hours, 2) END AS trifr
      FROM merged m LEFT JOIN projects p ON p.id = m.project_id
      ORDER BY ltifr DESC NULLS LAST, p.project_name
    `;

    return apiResponse.success(res, { totals, trend, byProject });
  } catch (error) {
    log.error('[H&S LTIFR Analytics] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

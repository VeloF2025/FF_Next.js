/**
 * API Route: /api/activate/reporting/time-to-activation
 *
 * Purpose: Get time-to-activation metrics (WA submission to OES activation)
 * Method: GET
 *
 * Query Parameters:
 * - dateFrom (required): Start date (YYYY-MM-DD)
 * - dateTo (required): End date (YYYY-MM-DD)
 * - project (optional): Filter by project name
 *
 * Returns distribution of activation times and daily averages
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

interface TimeBucket {
  bucket: string;
  count: number;
  avg_hours: number;
}

interface DailyAvg {
  date: string;
  count: number;
  avg_hours: number;
}

interface TimeToActivationResponse {
  summary: {
    total_matched: number;
    avg_hours: number;
    median_hours: number;
    same_day_percent: number;
    within_24h_percent: number;
  };
  buckets: TimeBucket[];
  daily_averages: DailyAvg[];
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TimeToActivationResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET','POST','PUT','DELETE','PATCH']);
  }

  try {
    const { dateFrom, dateTo, project } = req.query;

    if (!dateFrom || !dateTo) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
    }

    const dateFromStr = Array.isArray(dateFrom) ? dateFrom[0] : dateFrom;
    const dateToStr = Array.isArray(dateTo) ? dateTo[0] : dateTo;
    const projectStr = project
      ? Array.isArray(project)
        ? project[0]
        : project
      : undefined;

    log.info('TimeToActivationAPI', 'Fetching time-to-activation report', {
      dateFrom: dateFromStr,
      dateTo: dateToStr,
      project: projectStr,
    });

    // Explicit branches to avoid conditional SQL fragments inside CTEs (Neon rule)
    const bucketsResult = projectStr
      ? await sql`
          WITH matched AS (
            SELECT q.drop_number, q.created_at as wa_time, oes.activation_date as oes_time,
                   EXTRACT(EPOCH FROM (oes.activation_date - q.created_at)) / 3600 as hours_diff
            FROM qa_photo_reviews q INNER JOIN oes_activations oes ON oes.drop_number = q.drop_number
            WHERE q.created_at::date >= ${dateFromStr}::date AND q.created_at::date <= ${dateToStr}::date
              AND q.project = ${projectStr}
          )
          SELECT
            CASE WHEN hours_diff <= 0 THEN 'Same day (pre-submitted)' WHEN hours_diff <= 4 THEN 'Within 4 hours'
                 WHEN hours_diff <= 24 THEN '4-24 hours' WHEN hours_diff <= 72 THEN '1-3 days'
                 WHEN hours_diff <= 168 THEN '3-7 days' ELSE '7+ days' END as bucket,
            COUNT(DISTINCT drop_number) as count,
            AVG(GREATEST(hours_diff, 0))::numeric(10,1) as avg_hours
          FROM matched GROUP BY 1 ORDER BY MIN(hours_diff)
        `
      : await sql`
          WITH matched AS (
            SELECT q.drop_number, q.created_at as wa_time, oes.activation_date as oes_time,
                   EXTRACT(EPOCH FROM (oes.activation_date - q.created_at)) / 3600 as hours_diff
            FROM qa_photo_reviews q INNER JOIN oes_activations oes ON oes.drop_number = q.drop_number
            WHERE q.created_at::date >= ${dateFromStr}::date AND q.created_at::date <= ${dateToStr}::date
          )
          SELECT
            CASE WHEN hours_diff <= 0 THEN 'Same day (pre-submitted)' WHEN hours_diff <= 4 THEN 'Within 4 hours'
                 WHEN hours_diff <= 24 THEN '4-24 hours' WHEN hours_diff <= 72 THEN '1-3 days'
                 WHEN hours_diff <= 168 THEN '3-7 days' ELSE '7+ days' END as bucket,
            COUNT(DISTINCT drop_number) as count,
            AVG(GREATEST(hours_diff, 0))::numeric(10,1) as avg_hours
          FROM matched GROUP BY 1 ORDER BY MIN(hours_diff)
        `;

    // Get overall stats
    const statsResult = projectStr
      ? await sql`
          WITH matched AS (
            SELECT q.drop_number,
                   EXTRACT(EPOCH FROM (oes.activation_date - q.created_at)) / 3600 as hours_diff
            FROM qa_photo_reviews q INNER JOIN oes_activations oes ON oes.drop_number = q.drop_number
            WHERE q.created_at::date >= ${dateFromStr}::date AND q.created_at::date <= ${dateToStr}::date
              AND q.project = ${projectStr}
          )
          SELECT COUNT(DISTINCT drop_number) as total_matched,
            AVG(GREATEST(hours_diff, 0))::numeric(10,1) as avg_hours,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY GREATEST(hours_diff, 0))::numeric(10,1) as median_hours,
            (COUNT(DISTINCT CASE WHEN hours_diff <= 0 THEN drop_number END) * 100.0 / NULLIF(COUNT(DISTINCT drop_number), 0))::numeric(10,1) as same_day_percent,
            (COUNT(DISTINCT CASE WHEN hours_diff <= 24 THEN drop_number END) * 100.0 / NULLIF(COUNT(DISTINCT drop_number), 0))::numeric(10,1) as within_24h_percent
          FROM matched
        `
      : await sql`
          WITH matched AS (
            SELECT q.drop_number,
                   EXTRACT(EPOCH FROM (oes.activation_date - q.created_at)) / 3600 as hours_diff
            FROM qa_photo_reviews q INNER JOIN oes_activations oes ON oes.drop_number = q.drop_number
            WHERE q.created_at::date >= ${dateFromStr}::date AND q.created_at::date <= ${dateToStr}::date
          )
          SELECT COUNT(DISTINCT drop_number) as total_matched,
            AVG(GREATEST(hours_diff, 0))::numeric(10,1) as avg_hours,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY GREATEST(hours_diff, 0))::numeric(10,1) as median_hours,
            (COUNT(DISTINCT CASE WHEN hours_diff <= 0 THEN drop_number END) * 100.0 / NULLIF(COUNT(DISTINCT drop_number), 0))::numeric(10,1) as same_day_percent,
            (COUNT(DISTINCT CASE WHEN hours_diff <= 24 THEN drop_number END) * 100.0 / NULLIF(COUNT(DISTINCT drop_number), 0))::numeric(10,1) as within_24h_percent
          FROM matched
        `;

    // Get daily averages for trend chart
    const dailyResult = projectStr
      ? await sql`
          WITH matched AS (
            SELECT q.created_at::date as wa_date,
                   EXTRACT(EPOCH FROM (oes.activation_date - q.created_at)) / 3600 as hours_diff
            FROM qa_photo_reviews q INNER JOIN oes_activations oes ON oes.drop_number = q.drop_number
            WHERE q.created_at::date >= ${dateFromStr}::date AND q.created_at::date <= ${dateToStr}::date
              AND q.project = ${projectStr}
          )
          SELECT wa_date as date, COUNT(*) as count, AVG(GREATEST(hours_diff, 0))::numeric(10,1) as avg_hours
          FROM matched GROUP BY wa_date ORDER BY wa_date
        `
      : await sql`
          WITH matched AS (
            SELECT q.created_at::date as wa_date,
                   EXTRACT(EPOCH FROM (oes.activation_date - q.created_at)) / 3600 as hours_diff
            FROM qa_photo_reviews q INNER JOIN oes_activations oes ON oes.drop_number = q.drop_number
            WHERE q.created_at::date >= ${dateFromStr}::date AND q.created_at::date <= ${dateToStr}::date
          )
          SELECT wa_date as date, COUNT(*) as count, AVG(GREATEST(hours_diff, 0))::numeric(10,1) as avg_hours
          FROM matched GROUP BY wa_date ORDER BY wa_date
        `;

    const stats = statsResult[0] as {
      total_matched: number;
      avg_hours: number;
      median_hours: number;
      same_day_percent: number;
      within_24h_percent: number;
    };

    return res.status(200).json({
      summary: {
        total_matched: Number(stats.total_matched || 0),
        avg_hours: Number(stats.avg_hours || 0),
        median_hours: Number(stats.median_hours || 0),
        same_day_percent: Number(stats.same_day_percent || 0),
        within_24h_percent: Number(stats.within_24h_percent || 0),
      },
      buckets: (bucketsResult as TimeBucket[]).map((b) => ({
        bucket: b.bucket,
        count: Number(b.count),
        avg_hours: Number(b.avg_hours),
      })),
      daily_averages: (dailyResult as DailyAvg[]).map((d) => ({
        date: String(d.date),
        count: Number(d.count),
        avg_hours: Number(d.avg_hours),
      })),
    });
  } catch (error) {
    log.error('TimeToActivationAPI', 'Failed to fetch time-to-activation report', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('manager')(handler));

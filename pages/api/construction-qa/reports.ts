/**
 * Construction QA Reports API
 *
 * GET /api/construction-qa/reports
 *   Returns poles-planted aggregation with date filtering.
 *
 * Query params:
 *   period: 'today' | 'yesterday' | '7d' | '30d' | 'all' (default '7d')
 *   dateFrom: ISO date string (overrides period)
 *   dateTo:   ISO date string (overrides period)
 *   projectId: UUID — filter to a single project (optional)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth/middleware';

const sql = neon(process.env.DATABASE_URL!);

/** Compute SAST (UTC+2) date range from a period keyword */
function getDateRange(period: string): { from: string | null; to: string | null } {
  const now = new Date();
  // SAST offset: UTC+2
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const todayStr = sast.toISOString().slice(0, 10); // YYYY-MM-DD

  switch (period) {
    case 'today': {
      return { from: `${todayStr}T00:00:00+02:00`, to: null };
    }
    case 'yesterday': {
      const yd = new Date(sast);
      yd.setDate(yd.getDate() - 1);
      const ydStr = yd.toISOString().slice(0, 10);
      return { from: `${ydStr}T00:00:00+02:00`, to: `${todayStr}T00:00:00+02:00` };
    }
    case '7d': {
      const d7 = new Date(sast);
      d7.setDate(d7.getDate() - 7);
      return { from: `${d7.toISOString().slice(0, 10)}T00:00:00+02:00`, to: null };
    }
    case '30d': {
      const d30 = new Date(sast);
      d30.setDate(d30.getDate() - 30);
      return { from: `${d30.toISOString().slice(0, 10)}T00:00:00+02:00`, to: null };
    }
    case 'all':
    default:
      return { from: null, to: null };
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  try {
    const { period = '7d', dateFrom, dateTo, projectId } = req.query as {
      period?: string;
      dateFrom?: string;
      dateTo?: string;
      projectId?: string;
    };

    // Validate projectId format if provided
    const pid = projectId && /^[0-9a-f-]{36}$/i.test(projectId) ? projectId : null;

    // Resolve date range
    let from: string | null;
    let to: string | null;

    if (dateFrom) {
      from = `${dateFrom}T00:00:00+02:00`;
      to = dateTo ? `${dateTo}T23:59:59+02:00` : null;
    } else {
      const range = getDateRange(period);
      from = range.from;
      to = range.to;
    }

    // Build date-filtered queries — no conditional SQL fragments (Neon rule)
    const dateCol = 'COALESCE(r.last_photo_at, r.created_at)';

    // Summary query
    const summaryQuery = from && to
      ? sql`
          SELECT
            COUNT(*)::int AS planted,
            COUNT(*) FILTER (WHERE r.workflow_status = 'approved')::int AS approved,
            COUNT(*) FILTER (WHERE r.workflow_status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE r.workflow_status = 'rejected')::int AS rejected,
            COUNT(*) FILTER (WHERE r.workflow_status = 'rework_needed')::int AS rework,
            SUM(COALESCE(r.photo_count, 0))::int AS photos
          FROM construction_qa_reviews r
          WHERE r.feature_type = 'pole'
            AND (${pid}::uuid IS NULL OR r.project_id = ${pid}::uuid)
            AND COALESCE(r.last_photo_at, r.created_at) >= ${from}::timestamptz
            AND COALESCE(r.last_photo_at, r.created_at) < ${to}::timestamptz
        `
      : from
        ? sql`
            SELECT
              COUNT(*)::int AS planted,
              COUNT(*) FILTER (WHERE r.workflow_status = 'approved')::int AS approved,
              COUNT(*) FILTER (WHERE r.workflow_status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE r.workflow_status = 'rejected')::int AS rejected,
              COUNT(*) FILTER (WHERE r.workflow_status = 'rework_needed')::int AS rework,
              SUM(COALESCE(r.photo_count, 0))::int AS photos
            FROM construction_qa_reviews r
            WHERE r.feature_type = 'pole'
              AND (${pid}::uuid IS NULL OR r.project_id = ${pid}::uuid)
              AND COALESCE(r.last_photo_at, r.created_at) >= ${from}::timestamptz
          `
        : sql`
            SELECT
              COUNT(*)::int AS planted,
              COUNT(*) FILTER (WHERE r.workflow_status = 'approved')::int AS approved,
              COUNT(*) FILTER (WHERE r.workflow_status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE r.workflow_status = 'rejected')::int AS rejected,
              COUNT(*) FILTER (WHERE r.workflow_status = 'rework_needed')::int AS rework,
              SUM(COALESCE(r.photo_count, 0))::int AS photos
            FROM construction_qa_reviews r
            WHERE r.feature_type = 'pole'
              AND (${pid}::uuid IS NULL OR r.project_id = ${pid}::uuid)
          `;

    // By-project query
    const byProjectQuery = from && to
      ? sql`
          SELECT
            r.project_id,
            p.project_name,
            COUNT(*)::int AS planted,
            COUNT(*) FILTER (WHERE r.workflow_status = 'approved')::int AS approved,
            COUNT(*) FILTER (WHERE r.workflow_status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE r.workflow_status = 'rejected')::int AS rejected,
            COUNT(*) FILTER (WHERE r.workflow_status = 'rework_needed')::int AS rework,
            SUM(COALESCE(r.photo_count, 0))::int AS photos
          FROM construction_qa_reviews r
          JOIN projects p ON p.id = r.project_id
          WHERE r.feature_type = 'pole'
            AND (${pid}::uuid IS NULL OR r.project_id = ${pid}::uuid)
            AND COALESCE(r.last_photo_at, r.created_at) >= ${from}::timestamptz
            AND COALESCE(r.last_photo_at, r.created_at) < ${to}::timestamptz
          GROUP BY r.project_id, p.project_name
          ORDER BY planted DESC
        `
      : from
        ? sql`
            SELECT
              r.project_id,
              p.project_name,
              COUNT(*)::int AS planted,
              COUNT(*) FILTER (WHERE r.workflow_status = 'approved')::int AS approved,
              COUNT(*) FILTER (WHERE r.workflow_status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE r.workflow_status = 'rejected')::int AS rejected,
              COUNT(*) FILTER (WHERE r.workflow_status = 'rework_needed')::int AS rework,
              SUM(COALESCE(r.photo_count, 0))::int AS photos
            FROM construction_qa_reviews r
            JOIN projects p ON p.id = r.project_id
            WHERE r.feature_type = 'pole'
              AND (${pid}::uuid IS NULL OR r.project_id = ${pid}::uuid)
              AND COALESCE(r.last_photo_at, r.created_at) >= ${from}::timestamptz
            GROUP BY r.project_id, p.project_name
            ORDER BY planted DESC
          `
        : sql`
            SELECT
              r.project_id,
              p.project_name,
              COUNT(*)::int AS planted,
              COUNT(*) FILTER (WHERE r.workflow_status = 'approved')::int AS approved,
              COUNT(*) FILTER (WHERE r.workflow_status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE r.workflow_status = 'rejected')::int AS rejected,
              COUNT(*) FILTER (WHERE r.workflow_status = 'rework_needed')::int AS rework,
              SUM(COALESCE(r.photo_count, 0))::int AS photos
            FROM construction_qa_reviews r
            JOIN projects p ON p.id = r.project_id
            WHERE r.feature_type = 'pole'
              AND (${pid}::uuid IS NULL OR r.project_id = ${pid}::uuid)
            GROUP BY r.project_id, p.project_name
            ORDER BY planted DESC
          `;

    // By zone/PON query
    const byZonePonQuery = from && to
      ? sql`
          SELECT
            r.project_id,
            p.project_name,
            r.zone_no,
            r.pon_no,
            COUNT(*)::int AS planted,
            COUNT(*) FILTER (WHERE r.workflow_status = 'approved')::int AS approved,
            COUNT(*) FILTER (WHERE r.workflow_status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE r.workflow_status = 'rejected')::int AS rejected
          FROM construction_qa_reviews r
          JOIN projects p ON p.id = r.project_id
          WHERE r.feature_type = 'pole'
            AND (${pid}::uuid IS NULL OR r.project_id = ${pid}::uuid)
            AND COALESCE(r.last_photo_at, r.created_at) >= ${from}::timestamptz
            AND COALESCE(r.last_photo_at, r.created_at) < ${to}::timestamptz
          GROUP BY r.project_id, p.project_name, r.zone_no, r.pon_no
          ORDER BY p.project_name, r.zone_no, r.pon_no
        `
      : from
        ? sql`
            SELECT
              r.project_id,
              p.project_name,
              r.zone_no,
              r.pon_no,
              COUNT(*)::int AS planted,
              COUNT(*) FILTER (WHERE r.workflow_status = 'approved')::int AS approved,
              COUNT(*) FILTER (WHERE r.workflow_status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE r.workflow_status = 'rejected')::int AS rejected
            FROM construction_qa_reviews r
            JOIN projects p ON p.id = r.project_id
            WHERE r.feature_type = 'pole'
              AND (${pid}::uuid IS NULL OR r.project_id = ${pid}::uuid)
              AND COALESCE(r.last_photo_at, r.created_at) >= ${from}::timestamptz
            GROUP BY r.project_id, p.project_name, r.zone_no, r.pon_no
            ORDER BY p.project_name, r.zone_no, r.pon_no
          `
        : sql`
            SELECT
              r.project_id,
              p.project_name,
              r.zone_no,
              r.pon_no,
              COUNT(*)::int AS planted,
              COUNT(*) FILTER (WHERE r.workflow_status = 'approved')::int AS approved,
              COUNT(*) FILTER (WHERE r.workflow_status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE r.workflow_status = 'rejected')::int AS rejected
            FROM construction_qa_reviews r
            JOIN projects p ON p.id = r.project_id
            WHERE r.feature_type = 'pole'
              AND (${pid}::uuid IS NULL OR r.project_id = ${pid}::uuid)
            GROUP BY r.project_id, p.project_name, r.zone_no, r.pon_no
            ORDER BY p.project_name, r.zone_no, r.pon_no
          `;

    // Project list for filter dropdown (always unfiltered)
    const projectListQuery = sql`
      SELECT DISTINCT r.project_id, p.project_name
      FROM construction_qa_reviews r
      JOIN projects p ON p.id = r.project_id
      WHERE r.feature_type = 'pole'
      ORDER BY p.project_name
    `;

    const [summaryRows, byProjectRows, byZonePonRows, projectListRows] = await Promise.all([
      summaryQuery,
      byProjectQuery,
      byZonePonQuery,
      projectListQuery,
    ]);

    const summary = summaryRows[0] || {
      planted: 0, approved: 0, pending: 0, rejected: 0, rework: 0, photos: 0,
    };

    return apiResponse.success(res, {
      projects: projectListRows.map((r) => ({
        project_id: r.project_id,
        project_name: r.project_name,
      })),
      summary: {
        planted: Number(summary.planted),
        approved: Number(summary.approved),
        pending: Number(summary.pending),
        rejected: Number(summary.rejected),
        rework: Number(summary.rework),
        photos: Number(summary.photos),
      },
      byProject: byProjectRows.map((r) => ({
        project_id: r.project_id,
        project_name: r.project_name,
        planted: Number(r.planted),
        approved: Number(r.approved),
        pending: Number(r.pending),
        rejected: Number(r.rejected),
        rework: Number(r.rework),
        photos: Number(r.photos),
      })),
      byZonePon: byZonePonRows.map((r) => ({
        project_id: r.project_id,
        project_name: r.project_name,
        zone_no: r.zone_no != null ? Number(r.zone_no) : null,
        pon_no: r.pon_no != null ? Number(r.pon_no) : null,
        planted: Number(r.planted),
        approved: Number(r.approved),
        pending: Number(r.pending),
        rejected: Number(r.rejected),
      })),
    });
  } catch (error) {
    log.error('Construction QA reports API error', {
      module: 'construction-qa',
      error: (error as Error).message,
    });

    if ((error as Error).message?.includes('does not exist')) {
      return apiResponse.success(res, {
        projects: [],
        summary: { planted: 0, approved: 0, pending: 0, rejected: 0, rework: 0, photos: 0 },
        byProject: [],
        byZonePon: [],
      });
    }

    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

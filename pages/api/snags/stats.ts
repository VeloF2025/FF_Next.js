/**
 * Snags Stats API
 * GET /api/snags/stats
 * Returns snag counts per project for the dashboard.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { SnagProjectStats } from '@/modules/construction-qa/types/snag.types';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET']);
  }

  try {
    const rows = await sql`
      SELECT
        p.id                    AS project_id,
        p.name                  AS project_name,
        COUNT(s.id)             AS total,
        COUNT(s.id) FILTER (WHERE s.status = 'open')        AS open,
        COUNT(s.id) FILTER (WHERE s.status = 'assigned')    AS assigned,
        COUNT(s.id) FILTER (WHERE s.status = 'in_progress') AS in_progress,
        COUNT(s.id) FILTER (WHERE s.status = 'fixed')       AS fixed,
        COUNT(s.id) FILTER (WHERE s.status = 'verified')    AS verified,
        COUNT(s.id) FILTER (WHERE s.status = 'closed')      AS closed,
        COUNT(s.id) FILTER (WHERE s.status = 'reopened')    AS reopened,
        lr.report_number        AS latest_report_number,
        lr.audit_date           AS latest_report_date,
        lr.id                   AS latest_report_id
      FROM projects p
      INNER JOIN snags s ON s.project_id = p.id
      LEFT JOIN LATERAL (
        SELECT id, report_number, audit_date
        FROM snag_reports sr
        WHERE sr.project_id = p.id
        ORDER BY sr.audit_date DESC
        LIMIT 1
      ) lr ON TRUE
      GROUP BY p.id, p.name, lr.report_number, lr.audit_date, lr.id
      ORDER BY p.name ASC
    ` as Array<{
      project_id: string;
      project_name: string;
      total: string;
      open: string;
      assigned: string;
      in_progress: string;
      fixed: string;
      verified: string;
      closed: string;
      reopened: string;
      latest_report_number: string | null;
      latest_report_date: string | null;
      latest_report_id: string | null;
    }>;

    const stats: SnagProjectStats[] = rows.map((r) => ({
      project_id: r.project_id,
      project_name: r.project_name,
      total: parseInt(r.total, 10),
      open: parseInt(r.open, 10),
      assigned: parseInt(r.assigned, 10),
      in_progress: parseInt(r.in_progress, 10),
      fixed: parseInt(r.fixed, 10),
      verified: parseInt(r.verified, 10),
      closed: parseInt(r.closed, 10),
      reopened: parseInt(r.reopened, 10),
      latest_report_number: r.latest_report_number,
      latest_report_date: r.latest_report_date,
      latest_report_id: r.latest_report_id,
    }));

    return apiResponse.success(res, stats);
  } catch (error) {
    log.error('Snags stats API error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

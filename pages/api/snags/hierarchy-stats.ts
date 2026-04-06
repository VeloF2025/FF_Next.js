/**
 * Snags Hierarchy Stats API
 * GET /api/snags/hierarchy-stats?projectId=<id>
 * Returns snag counts grouped by project → zone → PON.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { HierarchyRow } from '@/modules/construction-qa/types/snag.types';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET']);
  }

  try {
    const { projectId } = req.query;

    type RawRow = {
      project_id: string;
      project_name: string;
      zone_no: string | null;
      pon_no: string | null;
      total: string;
      open: string;
      assigned: string;
      in_progress: string;
      fixed: string;
      verified: string;
      closed: string;
      reopened: string;
    };

    let rows: RawRow[];

    if (projectId && typeof projectId === 'string') {
      // Branch A — filtered by projectId
      rows = await sql`
        SELECT
          p.id AS project_id,
          p.project_name AS project_name,
          COALESCE(pole.zone_no, dr.zone_no) AS zone_no,
          COALESCE(pole.pon_no, dr.pon_no) AS pon_no,
          COUNT(s.id) AS total,
          COUNT(s.id) FILTER (WHERE s.status = 'open') AS open,
          COUNT(s.id) FILTER (WHERE s.status = 'assigned') AS assigned,
          COUNT(s.id) FILTER (WHERE s.status = 'in_progress') AS in_progress,
          COUNT(s.id) FILTER (WHERE s.status = 'fixed') AS fixed,
          COUNT(s.id) FILTER (WHERE s.status = 'verified') AS verified,
          COUNT(s.id) FILTER (WHERE s.status = 'closed') AS closed,
          COUNT(s.id) FILTER (WHERE s.status = 'reopened') AS reopened
        FROM projects p
        INNER JOIN snags s ON s.project_id = p.id
        LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
        LEFT JOIN drops dr ON dr.id = s.drop_id
        WHERE p.id = ${projectId}
        GROUP BY p.id, p.project_name, COALESCE(pole.zone_no, dr.zone_no), COALESCE(pole.pon_no, dr.pon_no)
        ORDER BY p.project_name ASC, COALESCE(pole.zone_no, dr.zone_no) ASC NULLS LAST, COALESCE(pole.pon_no, dr.pon_no) ASC NULLS LAST
      ` as RawRow[];
    } else {
      // Branch B — all projects
      rows = await sql`
        SELECT
          p.id AS project_id,
          p.project_name AS project_name,
          COALESCE(pole.zone_no, dr.zone_no) AS zone_no,
          COALESCE(pole.pon_no, dr.pon_no) AS pon_no,
          COUNT(s.id) AS total,
          COUNT(s.id) FILTER (WHERE s.status = 'open') AS open,
          COUNT(s.id) FILTER (WHERE s.status = 'assigned') AS assigned,
          COUNT(s.id) FILTER (WHERE s.status = 'in_progress') AS in_progress,
          COUNT(s.id) FILTER (WHERE s.status = 'fixed') AS fixed,
          COUNT(s.id) FILTER (WHERE s.status = 'verified') AS verified,
          COUNT(s.id) FILTER (WHERE s.status = 'closed') AS closed,
          COUNT(s.id) FILTER (WHERE s.status = 'reopened') AS reopened
        FROM projects p
        INNER JOIN snags s ON s.project_id = p.id
        LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
        LEFT JOIN drops dr ON dr.id = s.drop_id
        GROUP BY p.id, p.project_name, COALESCE(pole.zone_no, dr.zone_no), COALESCE(pole.pon_no, dr.pon_no)
        ORDER BY p.project_name ASC, COALESCE(pole.zone_no, dr.zone_no) ASC NULLS LAST, COALESCE(pole.pon_no, dr.pon_no) ASC NULLS LAST
      ` as RawRow[];
    }

    const data: HierarchyRow[] = rows.map((r) => ({
      project_id: r.project_id,
      project_name: r.project_name,
      zone_no: r.zone_no !== null ? Number(r.zone_no) : null,
      pon_no: r.pon_no !== null ? Number(r.pon_no) : null,
      total: parseInt(r.total, 10),
      open: parseInt(r.open, 10),
      assigned: parseInt(r.assigned, 10),
      in_progress: parseInt(r.in_progress, 10),
      fixed: parseInt(r.fixed, 10),
      verified: parseInt(r.verified, 10),
      closed: parseInt(r.closed, 10),
      reopened: parseInt(r.reopened, 10),
    }));

    return apiResponse.success(res, data);
  } catch (error) {
    log.error('Snags hierarchy-stats API error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

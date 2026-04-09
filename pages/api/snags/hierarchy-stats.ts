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
    const { projectId, search } = req.query;
    const searchTerm = typeof search === 'string' ? search.trim() : '';

    type RawRow = {
      project_id: string;
      project_name: string;
      zone_no: string | null;
      pon_no: string | null;
      total: string;
      open: string;
      assigned: string;
      in_progress: string;
      pending_qa: string;
      resolved: string;
      verified: string;
      closed: string;
    };

    let rows: RawRow[];

    const searchPattern = searchTerm ? `%${searchTerm}%` : '';

    // All branches use NOC ticket status when a ticket is linked,
    // otherwise fall back to snag status. Aligned to NOC Kanban columns:
    //   open:        NOC open         | snag open, reopened
    //   assigned:    NOC assigned     | snag assigned
    //   in_progress: NOC in_progress, qa_rejected | snag in_progress
    //   pending_qa:  NOC pending_qa, qa_in_progress | snag pending_qa, fixed (legacy)
    //   resolved:    NOC qa_approved, pending_handover, handed_to_ops, resolved | snag resolved
    //   verified:    NOC verified     | snag verified
    //   closed:      NOC closed, cancelled | snag closed

    if (projectId && typeof projectId === 'string' && searchTerm) {
      // Branch A — projectId + search
      rows = await sql`
        SELECT
          p.id AS project_id, p.project_name,
          COALESCE(pole.zone_no, dr.zone_no) AS zone_no,
          COALESCE(pole.pon_no, dr.pon_no) AS pon_no,
          COUNT(s.id) AS total,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status = 'open' ELSE s.status IN ('open','reopened') END) AS open,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status = 'assigned' ELSE s.status = 'assigned' END) AS assigned,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('in_progress','qa_rejected') ELSE s.status = 'in_progress' END) AS in_progress,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('pending_qa','qa_in_progress') ELSE s.status IN ('pending_qa','fixed') END) AS pending_qa,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('qa_approved','pending_handover','handed_to_ops','resolved') ELSE s.status = 'resolved' END) AS resolved,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status = 'verified' ELSE s.status = 'verified' END) AS verified,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('closed','cancelled') ELSE s.status = 'closed' END) AS closed
        FROM projects p
        INNER JOIN snags s ON s.project_id = p.id
        LEFT JOIN maintenance_tickets t ON t.id = s.noc_ticket_id
        LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
        LEFT JOIN drops dr ON dr.id = s.drop_id
        WHERE p.id = ${projectId}
          AND (
            s.description ILIKE ${searchPattern}
            OR EXISTS (SELECT 1 FROM unnest(s.pole_references) ref WHERE ref ILIKE ${searchPattern})
            OR pole.pole_number ILIKE ${searchPattern}
            OR dr.drop_number ILIKE ${searchPattern}
          )
        GROUP BY p.id, p.project_name, COALESCE(pole.zone_no, dr.zone_no), COALESCE(pole.pon_no, dr.pon_no)
        ORDER BY p.project_name ASC, COALESCE(pole.zone_no, dr.zone_no) ASC NULLS LAST, COALESCE(pole.pon_no, dr.pon_no) ASC NULLS LAST
      ` as RawRow[];
    } else if (projectId && typeof projectId === 'string') {
      // Branch B — projectId only
      rows = await sql`
        SELECT
          p.id AS project_id, p.project_name,
          COALESCE(pole.zone_no, dr.zone_no) AS zone_no,
          COALESCE(pole.pon_no, dr.pon_no) AS pon_no,
          COUNT(s.id) AS total,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status = 'open' ELSE s.status IN ('open','reopened') END) AS open,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status = 'assigned' ELSE s.status = 'assigned' END) AS assigned,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('in_progress','qa_rejected') ELSE s.status = 'in_progress' END) AS in_progress,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('pending_qa','qa_in_progress') ELSE s.status IN ('pending_qa','fixed') END) AS pending_qa,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('qa_approved','pending_handover','handed_to_ops','resolved') ELSE s.status = 'resolved' END) AS resolved,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status = 'verified' ELSE s.status = 'verified' END) AS verified,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('closed','cancelled') ELSE s.status = 'closed' END) AS closed
        FROM projects p
        INNER JOIN snags s ON s.project_id = p.id
        LEFT JOIN maintenance_tickets t ON t.id = s.noc_ticket_id
        LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
        LEFT JOIN drops dr ON dr.id = s.drop_id
        WHERE p.id = ${projectId}
        GROUP BY p.id, p.project_name, COALESCE(pole.zone_no, dr.zone_no), COALESCE(pole.pon_no, dr.pon_no)
        ORDER BY p.project_name ASC, COALESCE(pole.zone_no, dr.zone_no) ASC NULLS LAST, COALESCE(pole.pon_no, dr.pon_no) ASC NULLS LAST
      ` as RawRow[];
    } else if (searchTerm) {
      // Branch C — search only (all projects)
      rows = await sql`
        SELECT
          p.id AS project_id, p.project_name,
          COALESCE(pole.zone_no, dr.zone_no) AS zone_no,
          COALESCE(pole.pon_no, dr.pon_no) AS pon_no,
          COUNT(s.id) AS total,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status = 'open' ELSE s.status IN ('open','reopened') END) AS open,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status = 'assigned' ELSE s.status = 'assigned' END) AS assigned,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('in_progress','qa_rejected') ELSE s.status = 'in_progress' END) AS in_progress,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('pending_qa','qa_in_progress') ELSE s.status IN ('pending_qa','fixed') END) AS pending_qa,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('qa_approved','pending_handover','handed_to_ops','resolved') ELSE s.status = 'resolved' END) AS resolved,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status = 'verified' ELSE s.status = 'verified' END) AS verified,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('closed','cancelled') ELSE s.status = 'closed' END) AS closed
        FROM projects p
        INNER JOIN snags s ON s.project_id = p.id
        LEFT JOIN maintenance_tickets t ON t.id = s.noc_ticket_id
        LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
        LEFT JOIN drops dr ON dr.id = s.drop_id
        WHERE (
          s.description ILIKE ${searchPattern}
          OR EXISTS (SELECT 1 FROM unnest(s.pole_references) ref WHERE ref ILIKE ${searchPattern})
          OR pole.pole_number ILIKE ${searchPattern}
          OR dr.drop_number ILIKE ${searchPattern}
        )
        GROUP BY p.id, p.project_name, COALESCE(pole.zone_no, dr.zone_no), COALESCE(pole.pon_no, dr.pon_no)
        ORDER BY p.project_name ASC, COALESCE(pole.zone_no, dr.zone_no) ASC NULLS LAST, COALESCE(pole.pon_no, dr.pon_no) ASC NULLS LAST
      ` as RawRow[];
    } else {
      // Branch D — no filters
      rows = await sql`
        SELECT
          p.id AS project_id, p.project_name,
          COALESCE(pole.zone_no, dr.zone_no) AS zone_no,
          COALESCE(pole.pon_no, dr.pon_no) AS pon_no,
          COUNT(s.id) AS total,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status = 'open' ELSE s.status IN ('open','reopened') END) AS open,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status = 'assigned' ELSE s.status = 'assigned' END) AS assigned,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('in_progress','qa_rejected') ELSE s.status = 'in_progress' END) AS in_progress,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('pending_qa','qa_in_progress') ELSE s.status IN ('pending_qa','fixed') END) AS pending_qa,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('qa_approved','pending_handover','handed_to_ops','resolved') ELSE s.status = 'resolved' END) AS resolved,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status = 'verified' ELSE s.status = 'verified' END) AS verified,
          COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('closed','cancelled') ELSE s.status = 'closed' END) AS closed
        FROM projects p
        INNER JOIN snags s ON s.project_id = p.id
        LEFT JOIN maintenance_tickets t ON t.id = s.noc_ticket_id
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
      pending_qa: parseInt(r.pending_qa, 10),
      resolved: parseInt(r.resolved, 10),
      verified: parseInt(r.verified, 10),
      closed: parseInt(r.closed, 10),
    }));

    return apiResponse.success(res, data);
  } catch (error) {
    log.error('Snags hierarchy-stats API error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

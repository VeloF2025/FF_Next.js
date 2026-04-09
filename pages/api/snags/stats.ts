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
    // Use NOC ticket status when a ticket is linked, otherwise fall back to snag status.
    // Aligned to NOC Kanban columns:
    //   open:        NOC open         | snag open, reopened
    //   assigned:    NOC assigned     | snag assigned
    //   in_progress: NOC in_progress, qa_rejected | snag in_progress
    //   pending_qa:  NOC pending_qa, qa_in_progress | snag pending_qa, fixed (legacy)
    //   resolved:    NOC qa_approved, pending_handover, handed_to_ops, resolved | snag resolved
    //   verified:    NOC verified     | snag verified
    //   closed:      NOC closed, cancelled | snag closed
    const rows = await sql`
      SELECT
        p.id                    AS project_id,
        p.project_name                  AS project_name,
        COUNT(s.id)             AS total,
        COUNT(s.id) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL THEN t.status = 'open'
               ELSE s.status IN ('open','reopened') END
        ) AS open,
        COUNT(s.id) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL THEN t.status = 'assigned'
               ELSE s.status = 'assigned' END
        ) AS assigned,
        COUNT(s.id) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL THEN t.status IN ('in_progress','qa_rejected')
               ELSE s.status = 'in_progress' END
        ) AS in_progress,
        COUNT(s.id) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL THEN t.status IN ('pending_qa','qa_in_progress')
               ELSE s.status IN ('pending_qa','fixed') END
        ) AS pending_qa,
        COUNT(s.id) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL THEN t.status IN ('qa_approved','pending_handover','handed_to_ops','resolved')
               ELSE s.status = 'resolved' END
        ) AS resolved,
        COUNT(s.id) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL THEN t.status = 'verified'
               ELSE s.status = 'verified' END
        ) AS verified,
        COUNT(s.id) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL THEN t.status IN ('closed','cancelled')
               ELSE s.status = 'closed' END
        ) AS closed,
        lr.report_number        AS latest_report_number,
        lr.audit_date           AS latest_report_date,
        lr.id                   AS latest_report_id
      FROM projects p
      INNER JOIN snags s ON s.project_id = p.id
      LEFT JOIN maintenance_tickets t ON t.id = s.noc_ticket_id
      LEFT JOIN LATERAL (
        SELECT id, report_number, audit_date
        FROM snag_reports sr
        WHERE sr.project_id = p.id
        ORDER BY sr.audit_date DESC
        LIMIT 1
      ) lr ON TRUE
      GROUP BY p.id, p.project_name, lr.report_number, lr.audit_date, lr.id
      ORDER BY p.project_name ASC
    ` as Array<{
      project_id: string;
      project_name: string;
      total: string;
      open: string;
      assigned: string;
      in_progress: string;
      pending_qa: string;
      resolved: string;
      verified: string;
      closed: string;
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
      pending_qa: parseInt(r.pending_qa, 10),
      resolved: parseInt(r.resolved, 10),
      verified: parseInt(r.verified, 10),
      closed: parseInt(r.closed, 10),
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

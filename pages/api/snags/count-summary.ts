/**
 * Snags Count Summary API
 * GET /api/snags/count-summary
 *
 * Returns 7 status-bucket counts for the current filter context.
 * Accepts: projectId, category, severity, search, zone_no, pon_no.
 * Status is intentionally excluded so tiles always show the full breakdown.
 *
 * When a snag has a linked NOC ticket, the effective status is derived from
 * the ticket's status so that NOC progress is reflected in snag counts.
 *
 * Uses a single query with nullable params (IS NULL OR column = param)
 * to avoid combinatorial SQL branching.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

export interface SnagSummary {
  total: number;
  open: number;
  assigned: number;
  in_progress: number;
  pending_qa: number;
  resolved: number;
  verified: number;
  closed: number;
  critical: number;
}

type CountRow = {
  total: string;
  open: string;
  assigned: string;
  in_progress: string;
  pending_qa: string;
  resolved: string;
  verified: string;
  closed: string;
  critical: string;
};

function parseRow(row: CountRow): SnagSummary {
  return {
    total:       parseInt(row.total,       10),
    open:        parseInt(row.open,        10),
    assigned:    parseInt(row.assigned,    10),
    in_progress: parseInt(row.in_progress, 10),
    pending_qa:  parseInt(row.pending_qa,  10),
    resolved:    parseInt(row.resolved,    10),
    verified:    parseInt(row.verified,    10),
    closed:      parseInt(row.closed,      10),
    critical:    parseInt(row.critical ?? '0', 10),
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET']);
  }

  try {
    const { projectId, category, severity, search, zone_no, pon_no } = req.query;

    const p  = typeof projectId === 'string' && projectId ? projectId : null;
    const c  = typeof category  === 'string' && category  ? category  : null;
    const sv = typeof severity  === 'string' && severity  ? severity  : null;
    const se = typeof search    === 'string' && search    ? `%${search}%` : null;
    const zn = typeof zone_no   === 'string' && zone_no   ? parseInt(zone_no, 10) : null;
    const pn = typeof pon_no    === 'string' && pon_no    ? parseInt(pon_no, 10) : null;

    // Use the NOC ticket status when a ticket is linked, otherwise fall back to snag status.
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
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL
            THEN t.status = 'open'
            ELSE s.status IN ('open','reopened')
          END
        ) AS open,
        COUNT(*) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL
            THEN t.status = 'assigned'
            ELSE s.status = 'assigned'
          END
        ) AS assigned,
        COUNT(*) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL
            THEN t.status IN ('in_progress','qa_rejected')
            ELSE s.status = 'in_progress'
          END
        ) AS in_progress,
        COUNT(*) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL
            THEN t.status IN ('pending_qa','qa_in_progress')
            ELSE s.status IN ('pending_qa','fixed')
          END
        ) AS pending_qa,
        COUNT(*) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL
            THEN t.status IN ('qa_approved','pending_handover','handed_to_ops','resolved')
            ELSE s.status = 'resolved'
          END
        ) AS resolved,
        COUNT(*) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL
            THEN t.status = 'verified'
            ELSE s.status = 'verified'
          END
        ) AS verified,
        COUNT(*) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL
            THEN t.status IN ('closed','cancelled')
            ELSE s.status = 'closed'
          END
        ) AS closed,
        COUNT(*) FILTER (WHERE s.severity IN ('critical','major')) AS critical
      FROM snags s
      LEFT JOIN maintenance_tickets t ON t.id = s.noc_ticket_id
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE (${p}::text  IS NULL OR s.project_id::text = ${p})
        AND (${c}::text  IS NULL OR s.category = ${c})
        AND (${sv}::text IS NULL OR s.severity = ${sv})
        AND (${se}::text IS NULL OR s.description ILIKE ${se})
        AND (${zn}::int  IS NULL OR COALESCE(pole.zone_no, dr.zone_no) = ${zn})
        AND (${pn}::int  IS NULL OR COALESCE(pole.pon_no, dr.pon_no) = ${pn})
    ` as CountRow[];

    const empty: CountRow = { total: '0', open: '0', assigned: '0', in_progress: '0', pending_qa: '0', resolved: '0', verified: '0', closed: '0', critical: '0' };
    return apiResponse.success(res, parseRow(rows[0] ?? empty));
  } catch (error) {
    log.error('Snags count-summary API error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

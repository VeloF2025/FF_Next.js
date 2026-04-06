/**
 * Snags Count Summary API
 * GET /api/snags/count-summary
 *
 * Returns 4 status-bucket counts for the current filter context.
 * Accepts: projectId, category, severity, search, zone_no, pon_no.
 * Status is intentionally excluded so tiles always show the full breakdown.
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
  in_progress: number;
  resolved: number;
  critical: number;
}

type CountRow = { total: string; open: string; in_progress: string; resolved: string; critical: string };

function parseRow(row: CountRow): SnagSummary {
  return {
    total:       parseInt(row.total,       10),
    open:        parseInt(row.open,        10),
    in_progress: parseInt(row.in_progress, 10),
    resolved:    parseInt(row.resolved,    10),
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

    const rows = await sql`
      SELECT
        COUNT(*)                                                       AS total,
        COUNT(*) FILTER (WHERE s.status IN ('open','reopened'))        AS open,
        COUNT(*) FILTER (WHERE s.status IN ('assigned','in_progress')) AS in_progress,
        COUNT(*) FILTER (WHERE s.status IN ('fixed','verified','closed')) AS resolved,
        COUNT(*) FILTER (WHERE s.severity IN ('critical','major'))     AS critical
      FROM snags s
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE (${p}::text  IS NULL OR s.project_id::text = ${p})
        AND (${c}::text  IS NULL OR s.category = ${c})
        AND (${sv}::text IS NULL OR s.severity = ${sv})
        AND (${se}::text IS NULL OR s.description ILIKE ${se})
        AND (${zn}::int  IS NULL OR COALESCE(pole.zone_no, dr.zone_no) = ${zn})
        AND (${pn}::int  IS NULL OR COALESCE(pole.pon_no, dr.pon_no) = ${pn})
    ` as CountRow[];

    return apiResponse.success(res, parseRow(rows[0] ?? { total: '0', open: '0', in_progress: '0', resolved: '0', critical: '0' }));
  } catch (error) {
    log.error('Snags count-summary API error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

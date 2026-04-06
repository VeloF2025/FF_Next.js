/**
 * Snags Count Summary API
 * GET /api/snags/count-summary
 *
 * Returns 4 status-bucket counts for the current filter context.
 * Accepts: projectId, category, severity, search (NO status, NO pagination).
 * Status is intentionally excluded so tiles always show the full breakdown.
 *
 * Uses explicit SQL branches (Neon constraint — no conditional fragments).
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
    const { projectId, category, severity, search } = req.query;

    const p = typeof projectId === 'string' && projectId ? projectId : null;
    const c = typeof category  === 'string' && category  ? category  : null;
    const sv = typeof severity === 'string' && severity  ? severity  : null;
    const se = typeof search   === 'string' && search    ? `%${search}%` : null;

    let rows: CountRow[];

    // 16 explicit branches: {p, c, sv} × {se|no-se}, most-specific first
    if (p && c && sv && se) {
      rows = await sql`
        SELECT
          COUNT(*)                                                                    AS total,
          COUNT(*) FILTER (WHERE status IN ('open','reopened'))                     AS open,
          COUNT(*) FILTER (WHERE status IN ('assigned','in_progress'))              AS in_progress,
          COUNT(*) FILTER (WHERE status IN ('fixed','verified','closed'))            AS resolved,
          COUNT(*) FILTER (WHERE severity IN ('critical','major'))                  AS critical
        FROM snags
        WHERE project_id = ${p} AND category = ${c} AND severity = ${sv}
          AND description ILIKE ${se}
      ` as CountRow[];
    } else if (p && c && sv) {
      rows = await sql`
        SELECT
          COUNT(*)                                                                    AS total,
          COUNT(*) FILTER (WHERE status IN ('open','reopened'))                     AS open,
          COUNT(*) FILTER (WHERE status IN ('assigned','in_progress'))              AS in_progress,
          COUNT(*) FILTER (WHERE status IN ('fixed','verified','closed'))            AS resolved,
          COUNT(*) FILTER (WHERE severity IN ('critical','major'))                  AS critical
        FROM snags
        WHERE project_id = ${p} AND category = ${c} AND severity = ${sv}
      ` as CountRow[];
    } else if (p && c && se) {
      rows = await sql`
        SELECT
          COUNT(*)                                                                    AS total,
          COUNT(*) FILTER (WHERE status IN ('open','reopened'))                     AS open,
          COUNT(*) FILTER (WHERE status IN ('assigned','in_progress'))              AS in_progress,
          COUNT(*) FILTER (WHERE status IN ('fixed','verified','closed'))            AS resolved,
          COUNT(*) FILTER (WHERE severity IN ('critical','major'))                  AS critical
        FROM snags
        WHERE project_id = ${p} AND category = ${c} AND description ILIKE ${se}
      ` as CountRow[];
    } else if (p && sv && se) {
      rows = await sql`
        SELECT
          COUNT(*)                                                                    AS total,
          COUNT(*) FILTER (WHERE status IN ('open','reopened'))                     AS open,
          COUNT(*) FILTER (WHERE status IN ('assigned','in_progress'))              AS in_progress,
          COUNT(*) FILTER (WHERE status IN ('fixed','verified','closed'))            AS resolved,
          COUNT(*) FILTER (WHERE severity IN ('critical','major'))                  AS critical
        FROM snags
        WHERE project_id = ${p} AND severity = ${sv} AND description ILIKE ${se}
      ` as CountRow[];
    } else if (c && sv && se) {
      rows = await sql`
        SELECT
          COUNT(*)                                                                    AS total,
          COUNT(*) FILTER (WHERE status IN ('open','reopened'))                     AS open,
          COUNT(*) FILTER (WHERE status IN ('assigned','in_progress'))              AS in_progress,
          COUNT(*) FILTER (WHERE status IN ('fixed','verified','closed'))            AS resolved,
          COUNT(*) FILTER (WHERE severity IN ('critical','major'))                  AS critical
        FROM snags
        WHERE category = ${c} AND severity = ${sv} AND description ILIKE ${se}
      ` as CountRow[];
    } else if (p && c) {
      rows = await sql`
        SELECT
          COUNT(*)                                                                    AS total,
          COUNT(*) FILTER (WHERE status IN ('open','reopened'))                     AS open,
          COUNT(*) FILTER (WHERE status IN ('assigned','in_progress'))              AS in_progress,
          COUNT(*) FILTER (WHERE status IN ('fixed','verified','closed'))            AS resolved,
          COUNT(*) FILTER (WHERE severity IN ('critical','major'))                  AS critical
        FROM snags
        WHERE project_id = ${p} AND category = ${c}
      ` as CountRow[];
    } else if (p && sv) {
      rows = await sql`
        SELECT
          COUNT(*)                                                                    AS total,
          COUNT(*) FILTER (WHERE status IN ('open','reopened'))                     AS open,
          COUNT(*) FILTER (WHERE status IN ('assigned','in_progress'))              AS in_progress,
          COUNT(*) FILTER (WHERE status IN ('fixed','verified','closed'))            AS resolved,
          COUNT(*) FILTER (WHERE severity IN ('critical','major'))                  AS critical
        FROM snags
        WHERE project_id = ${p} AND severity = ${sv}
      ` as CountRow[];
    } else if (p && se) {
      rows = await sql`
        SELECT
          COUNT(*)                                                                    AS total,
          COUNT(*) FILTER (WHERE status IN ('open','reopened'))                     AS open,
          COUNT(*) FILTER (WHERE status IN ('assigned','in_progress'))              AS in_progress,
          COUNT(*) FILTER (WHERE status IN ('fixed','verified','closed'))            AS resolved,
          COUNT(*) FILTER (WHERE severity IN ('critical','major'))                  AS critical
        FROM snags
        WHERE project_id = ${p} AND description ILIKE ${se}
      ` as CountRow[];
    } else if (c && sv) {
      rows = await sql`
        SELECT
          COUNT(*)                                                                    AS total,
          COUNT(*) FILTER (WHERE status IN ('open','reopened'))                     AS open,
          COUNT(*) FILTER (WHERE status IN ('assigned','in_progress'))              AS in_progress,
          COUNT(*) FILTER (WHERE status IN ('fixed','verified','closed'))            AS resolved,
          COUNT(*) FILTER (WHERE severity IN ('critical','major'))                  AS critical
        FROM snags
        WHERE category = ${c} AND severity = ${sv}
      ` as CountRow[];
    } else if (c && se) {
      rows = await sql`
        SELECT
          COUNT(*)                                                                    AS total,
          COUNT(*) FILTER (WHERE status IN ('open','reopened'))                     AS open,
          COUNT(*) FILTER (WHERE status IN ('assigned','in_progress'))              AS in_progress,
          COUNT(*) FILTER (WHERE status IN ('fixed','verified','closed'))            AS resolved,
          COUNT(*) FILTER (WHERE severity IN ('critical','major'))                  AS critical
        FROM snags
        WHERE category = ${c} AND description ILIKE ${se}
      ` as CountRow[];
    } else if (sv && se) {
      rows = await sql`
        SELECT
          COUNT(*)                                                                    AS total,
          COUNT(*) FILTER (WHERE status IN ('open','reopened'))                     AS open,
          COUNT(*) FILTER (WHERE status IN ('assigned','in_progress'))              AS in_progress,
          COUNT(*) FILTER (WHERE status IN ('fixed','verified','closed'))            AS resolved,
          COUNT(*) FILTER (WHERE severity IN ('critical','major'))                  AS critical
        FROM snags
        WHERE severity = ${sv} AND description ILIKE ${se}
      ` as CountRow[];
    } else if (p) {
      rows = await sql`
        SELECT
          COUNT(*)                                                                    AS total,
          COUNT(*) FILTER (WHERE status IN ('open','reopened'))                     AS open,
          COUNT(*) FILTER (WHERE status IN ('assigned','in_progress'))              AS in_progress,
          COUNT(*) FILTER (WHERE status IN ('fixed','verified','closed'))            AS resolved,
          COUNT(*) FILTER (WHERE severity IN ('critical','major'))                  AS critical
        FROM snags
        WHERE project_id = ${p}
      ` as CountRow[];
    } else if (c) {
      rows = await sql`
        SELECT
          COUNT(*)                                                                    AS total,
          COUNT(*) FILTER (WHERE status IN ('open','reopened'))                     AS open,
          COUNT(*) FILTER (WHERE status IN ('assigned','in_progress'))              AS in_progress,
          COUNT(*) FILTER (WHERE status IN ('fixed','verified','closed'))            AS resolved,
          COUNT(*) FILTER (WHERE severity IN ('critical','major'))                  AS critical
        FROM snags
        WHERE category = ${c}
      ` as CountRow[];
    } else if (sv) {
      rows = await sql`
        SELECT
          COUNT(*)                                                                    AS total,
          COUNT(*) FILTER (WHERE status IN ('open','reopened'))                     AS open,
          COUNT(*) FILTER (WHERE status IN ('assigned','in_progress'))              AS in_progress,
          COUNT(*) FILTER (WHERE status IN ('fixed','verified','closed'))            AS resolved,
          COUNT(*) FILTER (WHERE severity IN ('critical','major'))                  AS critical
        FROM snags
        WHERE severity = ${sv}
      ` as CountRow[];
    } else if (se) {
      rows = await sql`
        SELECT
          COUNT(*)                                                                    AS total,
          COUNT(*) FILTER (WHERE status IN ('open','reopened'))                     AS open,
          COUNT(*) FILTER (WHERE status IN ('assigned','in_progress'))              AS in_progress,
          COUNT(*) FILTER (WHERE status IN ('fixed','verified','closed'))            AS resolved,
          COUNT(*) FILTER (WHERE severity IN ('critical','major'))                  AS critical
        FROM snags
        WHERE description ILIKE ${se}
      ` as CountRow[];
    } else {
      rows = await sql`
        SELECT
          COUNT(*)                                                                    AS total,
          COUNT(*) FILTER (WHERE status IN ('open','reopened'))                     AS open,
          COUNT(*) FILTER (WHERE status IN ('assigned','in_progress'))              AS in_progress,
          COUNT(*) FILTER (WHERE status IN ('fixed','verified','closed'))            AS resolved,
          COUNT(*) FILTER (WHERE severity IN ('critical','major'))                  AS critical
        FROM snags
      ` as CountRow[];
    }

    return apiResponse.success(res, parseRow(rows[0] ?? { total: '0', open: '0', in_progress: '0', resolved: '0', critical: '0' }));
  } catch (error) {
    log.error('Snags count-summary API error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

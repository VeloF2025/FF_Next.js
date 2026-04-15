/**
 * OLT Report Projects API
 *
 * GET: Return distinct project names that have records for a given status group.
 * Used to populate the project filter dropdown in the Investigate tab.
 *
 * Query params:
 * - status: pending | needs_investigation | fixed | escalated | resolved | all (default: all)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const status = String(req.query.status || 'all');

    let whereClause = '';
    if (status === 'pending') {
      whereClause = "WHERE r.fix_status = 'pending' AND r.olt_serial IS NOT NULL";
    } else if (status === 'needs_investigation') {
      whereClause = "WHERE (r.fix_status IN ('not_found', 'needs_investigation', 'needs_reinvestigation', 'empty_serial') OR r.olt_serial IS NULL)";
    } else if (status === 'fixed') {
      whereClause = "WHERE r.fix_status = 'fixed'";
    } else if (status === 'escalated') {
      whereClause = "WHERE r.fix_status = 'escalated'";
    } else if (status === 'resolved') {
      whereClause = "WHERE r.fix_status = 'resolved'";
    }

    const result = await pool.query(`
      SELECT DISTINCT COALESCE(i.project, p.project_name) AS project
      FROM olt_mismatch_records r
      LEFT JOIN olt_report_imports i ON r.import_id = i.id
      LEFT JOIN drops d ON r.drop_number = d.drop_number
      LEFT JOIN projects p ON d.project_id = p.id
      ${whereClause}
    `);

    const projects = (result.rows as Array<{ project: string | null }>)
      .map((row) => row.project)
      .filter((name: string | null): name is string => Boolean(name))
      .sort((a: string, b: string) => a.localeCompare(b));

    return apiResponse.success(res, { projects });
  } catch (error) {
    log.error('olt-report-projects', { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

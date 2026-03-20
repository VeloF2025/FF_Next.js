/**
 * OLT Report Imports History API
 *
 * GET: Return list of OLT report imports with stats
 *
 * Query params:
 * - limit: max records to return (default 50)
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
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
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));

    const result = await pool.query(`
      SELECT
        i.id,
        i.filename,
        i.project,
        i.report_date,
        i.total_records,
        i.match_count,
        i.mismatch_count,
        i.empty_serial_count,
        i.not_found_count,
        i.imported_at,
        u.email as imported_by_email
      FROM olt_report_imports i
      LEFT JOIN users u ON i.imported_by = u.id
      ORDER BY i.imported_at DESC
      LIMIT $1
    `, [limit]);

    return apiResponse.success(res, {
      imports: result.rows,
    });
  } catch (error) {
    log.error('olt-report-imports', { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

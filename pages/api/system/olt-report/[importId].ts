/**
 * OLT Report Import Detail API
 *
 * GET: Get details of a specific import including all mismatch records
 *
 * Returns full audit trail: what was imported, what was fixed, old/new values
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth';
import { log } from '@/lib/logger';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const client = await pool.connect();
  const { importId } = req.query;

  try {
    // Get import details
    const importResult = await client.query(
      `SELECT
        i.*,
        u.email as imported_by_email,
        CONCAT(u.first_name, ' ', u.last_name) as imported_by_name
      FROM olt_report_imports i
      LEFT JOIN users u ON i.imported_by = u.id
      WHERE i.id = $1`,
      [importId]
    );

    if (importResult.rows.length === 0) {
      return apiResponse.notFound(res, 'Import', importId as string);
    }

    const importData = importResult.rows[0];

    // Get all mismatch records for this import
    const recordsResult = await client.query(
      `SELECT
        m.*,
        u.email as fixed_by_email,
        CONCAT(u.first_name, ' ', u.last_name) as fixed_by_name
      FROM olt_mismatch_records m
      LEFT JOIN users u ON m.fix_by = u.id
      WHERE m.import_id = $1
      ORDER BY
        CASE m.fix_status
          WHEN 'fixed' THEN 0
          WHEN 'pending' THEN 1
          WHEN 'empty_serial' THEN 2
          ELSE 3
        END,
        m.drop_number`,
      [importId]
    );

    // Get activity log entries for these DRs
    const drNumbers = recordsResult.rows.map((r) => r.drop_number);
    let activityLog: Array<Record<string, unknown>> = [];

    if (drNumbers.length > 0) {
      const activityResult = await client.query(
        `SELECT
          drop_number,
          event_type,
          event_data,
          created_by,
          created_at
        FROM dr_activity_log
        WHERE drop_number = ANY($1)
          AND (event_data->>'source' = 'olt_report' OR event_data->>'source' = 'olt_report_import')
        ORDER BY created_at DESC`,
        [drNumbers]
      );
      activityLog = activityResult.rows;
    }

    // Calculate stats
    const stats = {
      total: recordsResult.rows.length,
      fixed: recordsResult.rows.filter((r) => r.fix_status === 'fixed').length,
      pending: recordsResult.rows.filter((r) => r.fix_status === 'pending').length,
      empty: recordsResult.rows.filter((r) => r.fix_status === 'empty_serial').length,
    };

    return apiResponse.success(res, {
      import: importData,
      records: recordsResult.rows,
      activityLog,
      stats,
    });
  } catch (error) {
    log.error('OltReportDetail', 'Failed to fetch import details', { error, importId });
    return apiResponse.internalError(res, error);
  } finally {
    client.release();
  }
}

export default withAuth(withRole('manager')(handler));

/**
 * OLT Report Records API
 *
 * GET: Return OLT mismatch records with pagination and filtering
 *
 * Query params:
 * - status: pending | needs_investigation | fixed | escalated | all
 * - page: page number (default 1)
 * - pageSize: records per page (default 50, max 100)
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const status = String(req.query.status || 'pending');
    const source = req.query.source ? String(req.query.source) : null;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '50'), 10)));
    const offset = (page - 1) * pageSize;

    // Build WHERE clause based on status
    let whereClause = '';
    const params: (string | number)[] = [];

    if (status === 'pending') {
      whereClause = "WHERE r.fix_status = 'pending' AND r.olt_serial IS NOT NULL";
    } else if (status === 'needs_investigation') {
      whereClause = "WHERE r.fix_status IN ('not_found', 'needs_investigation', 'needs_reinvestigation', 'empty_serial') OR r.olt_serial IS NULL";
    } else if (status === 'fixed') {
      whereClause = "WHERE r.fix_status = 'fixed'";
    } else if (status === 'escalated') {
      whereClause = "WHERE r.fix_status = 'escalated'";
    } else if (status === 'resolved') {
      whereClause = "WHERE r.fix_status = 'resolved'";
    }
    // 'all' = no WHERE clause

    // Optional source filter - parameterized to prevent SQL injection
    const validSources = ['auto', 'manual'];
    if (source && validSources.includes(source)) {
      params.push(source);
      const sourceCondition = `r.detection_source = $${params.length}`;
      whereClause = whereClause
        ? `${whereClause} AND ${sourceCondition}`
        : `WHERE ${sourceCondition}`;
    }

    // Get total count
    const countResult = await pool.query(`
      SELECT COUNT(*)::int as total
      FROM olt_mismatch_records r
      ${whereClause}
    `, params);
    const total = countResult.rows[0]?.total || 0;

    // Get records with import info
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const result = await pool.query(`
      SELECT
        r.id,
        r.drop_number,
        r.olt_serial,
        r.wrong_onemap_serial,
        r.row_index,
        r.fix_status,
        r.fix_attempted_at,
        r.fix_result,
        r.fix_old_value,
        r.has_ups_swap,
        r.detection_source,
        r.investigation_context,
        r.resolution_type,
        r.resolution_notes,
        r.escalated_at,
        r.resolved_at,
        r.created_at,
        i.filename as import_filename,
        i.imported_at as import_date,
        i.project
      FROM olt_mismatch_records r
      LEFT JOIN olt_report_imports i ON r.import_id = i.id
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `, [...params, pageSize, offset]);

    return apiResponse.success(res, {
      records: result.rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

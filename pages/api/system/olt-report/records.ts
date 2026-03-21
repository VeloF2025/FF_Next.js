/**
 * OLT Report Records API
 *
 * GET: Return OLT mismatch records with pagination and filtering
 *
 * Query params:
 * - status: pending | needs_investigation | fixed | escalated | all
 * - page: page number (default 1)
 * - pageSize: records per page (default 50, max 100)
 * - dateFrom: ISO date string (filter by date range)
 * - dateTo: ISO date string (filter by date range)
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
    const status = String(req.query.status || 'pending');
    const source = req.query.source ? String(req.query.source) : null;
    const subStatus = req.query.subStatus ? String(req.query.subStatus) : null;
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : null;
    const dateTo = req.query.dateTo ? String(req.query.dateTo) : null;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '50'), 10)));
    const offset = (page - 1) * pageSize;

    // Build WHERE clause based on status
    let whereClause = '';
    const params: (string | number)[] = [];

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

    // Optional sub-status filter (within needs_investigation group)
    const validSubStatuses = ['needs_investigation', 'not_found', 'empty_serial'];
    if (subStatus && validSubStatuses.includes(subStatus)) {
      if (subStatus === 'needs_investigation') {
        const cond = `r.fix_status IN ('needs_investigation', 'needs_reinvestigation')`;
        whereClause = whereClause ? `${whereClause} AND ${cond}` : `WHERE ${cond}`;
      } else {
        params.push(subStatus);
        const cond = `r.fix_status = $${params.length}`;
        whereClause = whereClause ? `${whereClause} AND ${cond}` : `WHERE ${cond}`;
      }
    }

    // Optional search filter (DR number, OLT serial)
    const search = req.query.search ? String(req.query.search).trim() : null;
    if (search) {
      params.push(`%${search}%`);
      const searchIdx = params.length;
      const cond = `(r.drop_number ILIKE $${searchIdx} OR r.olt_serial ILIKE $${searchIdx} OR r.wrong_onemap_serial ILIKE $${searchIdx})`;
      whereClause = whereClause ? `${whereClause} AND ${cond}` : `WHERE ${cond}`;
    }

    // Optional date range filter
    if (dateFrom) {
      params.push(dateFrom);
      const cond = `COALESCE(r.fix_attempted_at, r.created_at) >= $${params.length}::timestamptz`;
      whereClause = whereClause ? `${whereClause} AND ${cond}` : `WHERE ${cond}`;
    }
    if (dateTo) {
      params.push(dateTo);
      const cond = `COALESCE(r.fix_attempted_at, r.created_at) < $${params.length}::timestamptz`;
      whereClause = whereClause ? `${whereClause} AND ${cond}` : `WHERE ${cond}`;
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
        r.maintenance_ticket_id,
        mt.ticket_uid,
        i.filename as import_filename,
        i.imported_at as import_date,
        COALESCE(i.project, p.project_name) as project
      FROM olt_mismatch_records r
      LEFT JOIN olt_report_imports i ON r.import_id = i.id
      LEFT JOIN drops d ON r.drop_number = d.drop_number
      LEFT JOIN projects p ON d.project_id = p.id
      LEFT JOIN maintenance_tickets mt ON r.maintenance_ticket_id = mt.id
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
    log.error('olt-report-records', { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

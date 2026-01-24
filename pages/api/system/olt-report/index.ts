/**
 * OLT Report List API
 *
 * GET: List OLT report imports and pending fixes
 *
 * Query params:
 * - view: 'imports' | 'pending' | 'fixed' | 'all' (default: 'pending')
 * - importId: Filter by specific import
 * - page, pageSize: Pagination
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

  try {
    const {
      view = 'pending',
      importId,
      page = '1',
      pageSize = '50',
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const pageSizeNum = parseInt(pageSize as string, 10);
    const offset = (pageNum - 1) * pageSizeNum;

    // Get import history
    if (view === 'imports') {
      const result = await client.query(`
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
        LIMIT $1 OFFSET $2
      `, [pageSizeNum, offset]);

      const countResult = await client.query(
        'SELECT COUNT(*) FROM olt_report_imports'
      );

      return apiResponse.success(res, {
        view: 'imports',
        imports: result.rows,
        total: Number(countResult.rows[0].count),
        page: pageNum,
        pageSize: pageSizeNum,
      });
    }

    // Get OLT vs 1Map mismatches using the view
    let conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (view === 'pending') {
      conditions.push(`(onemap_fix_attempted = false OR onemap_fix_attempted IS NULL)`);
      conditions.push(`comparison_status = 'mismatch'`);
    } else if (view === 'fixed') {
      conditions.push(`onemap_fix_result = 'success'`);
    }

    if (importId) {
      conditions.push(`olt_report_id = $${paramIndex}`);
      params.push(importId as string);
      paramIndex++;
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // Check if the view exists, fall back to direct query if not
    let result;
    try {
      result = await client.query(`
        SELECT
          id,
          drop_number,
          zone,
          address,
          olt_serial,
          onemap_serial,
          onemap_prop_id,
          offline_serial,
          oes_serial,
          onemap_fix_attempted,
          onemap_fix_result,
          onemap_fix_old_value,
          onemap_fix_at,
          status,
          comparison_status,
          import_filename,
          import_date
        FROM v_olt_onemap_mismatches
        ${whereClause}
        ORDER BY
          CASE WHEN comparison_status = 'mismatch' THEN 0 ELSE 1 END,
          import_date DESC NULLS LAST
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `, [...params, pageSizeNum, offset]);
    } catch {
      // View doesn't exist yet, use direct query
      result = await client.query(`
        SELECT
          o.id,
          o.drop_number,
          o.zone,
          o.address,
          o.olt_serial,
          r.ont_serial_scanned as onemap_serial,
          r.prop_id as onemap_prop_id,
          o.serial_number as offline_serial,
          e.serial_number as oes_serial,
          o.onemap_fix_attempted,
          o.onemap_fix_result,
          o.onemap_fix_old_value,
          o.onemap_fix_at,
          COALESCE(o.mismatch_status, 'pending_investigation') as status,
          CASE
            WHEN o.olt_serial IS NULL THEN 'empty_olt'
            WHEN r.ont_serial_scanned IS NULL THEN 'no_onemap'
            WHEN UPPER(o.olt_serial) = UPPER(r.ont_serial_scanned) THEN 'match'
            ELSE 'mismatch'
          END as comparison_status,
          oi.filename as import_filename,
          oi.imported_at as import_date
        FROM offline_devices o
        LEFT JOIN dr_photo_unified_reviews r ON o.drop_number = r.drop_number
        LEFT JOIN oes_activations e ON o.drop_number = e.drop_number
        LEFT JOIN olt_report_imports oi ON o.olt_report_id = oi.id
        WHERE o.olt_serial IS NOT NULL
        ORDER BY o.olt_imported_at DESC NULLS LAST
        LIMIT $1 OFFSET $2
      `, [pageSizeNum, offset]);
    }

    // Get count
    let totalCount = 0;
    try {
      const countResult = await client.query(`
        SELECT COUNT(*) FROM v_olt_onemap_mismatches ${whereClause}
      `, params);
      totalCount = Number(countResult.rows[0].count);
    } catch {
      const countResult = await client.query(`
        SELECT COUNT(*) FROM offline_devices WHERE olt_serial IS NOT NULL
      `);
      totalCount = Number(countResult.rows[0].count);
    }

    // Get summary stats
    let stats = { pending: 0, fixed: 0, empty: 0, match: 0 };
    try {
      const statsResult = await client.query(`
        SELECT
          COUNT(*) FILTER (WHERE comparison_status = 'mismatch' AND (onemap_fix_attempted = false OR onemap_fix_attempted IS NULL)) as pending,
          COUNT(*) FILTER (WHERE onemap_fix_result = 'success') as fixed,
          COUNT(*) FILTER (WHERE comparison_status = 'empty_olt') as empty,
          COUNT(*) FILTER (WHERE comparison_status = 'match') as match
        FROM v_olt_onemap_mismatches
      `);
      stats = {
        pending: Number(statsResult.rows[0].pending) || 0,
        fixed: Number(statsResult.rows[0].fixed) || 0,
        empty: Number(statsResult.rows[0].empty) || 0,
        match: Number(statsResult.rows[0].match) || 0,
      };
    } catch {
      // View doesn't exist
    }

    return apiResponse.success(res, {
      view,
      records: result.rows,
      stats,
      total: totalCount,
      page: pageNum,
      pageSize: pageSizeNum,
    });
  } catch (error) {
    log.error('OltReportList', 'Failed to fetch OLT report data', { error });
    return apiResponse.internalError(res, error);
  } finally {
    client.release();
  }
}

export default withAuth(withRole('manager')(handler));

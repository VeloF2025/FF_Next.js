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

    // Query from olt_mismatch_records (the authoritative source)
    let conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (view === 'pending') {
      // Fixable: Has correct ONT serial from OLT report (column B)
      // wrong_onemap_serial (column V) is optional - just for audit
      conditions.push(`m.fix_status = 'pending'`);
      conditions.push(`m.olt_serial IS NOT NULL`);
      conditions.push(`m.olt_serial != ''`);
    } else if (view === 'needs_investigation') {
      // Records needing manual investigation:
      // 1. No correct serial to upload (empty olt_serial)
      // 2. DR not found in 1Map (moved to needs_investigation status)
      conditions.push(`(
        (m.fix_status = 'pending' AND (m.olt_serial IS NULL OR m.olt_serial = ''))
        OR m.fix_status = 'needs_investigation'
      )`)
    } else if (view === 'fixed') {
      conditions.push(`m.fix_status = 'fixed'`);
    } else if (view === 'empty') {
      conditions.push(`m.fix_status = 'empty_serial'`);
    }

    if (importId) {
      conditions.push(`m.import_id = $${paramIndex}`);
      params.push(importId as string);
      paramIndex++;
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // Query from olt_mismatch_records with joined data
    const result = await client.query(`
      SELECT
        m.id,
        m.drop_number,
        m.olt_serial,
        m.wrong_onemap_serial,
        m.row_index,
        m.fix_status,
        m.fix_attempted_at,
        m.fix_result,
        m.fix_old_value,
        m.created_at,
        i.filename as import_filename,
        i.imported_at as import_date,
        i.project
      FROM olt_mismatch_records m
      LEFT JOIN olt_report_imports i ON m.import_id = i.id
      ${whereClause}
      ORDER BY
        CASE m.fix_status
          WHEN 'pending' THEN 0
          WHEN 'empty_serial' THEN 1
          WHEN 'fixed' THEN 2
          ELSE 3
        END,
        m.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, pageSizeNum, offset]);

    // Get count
    const countResult = await client.query(`
      SELECT COUNT(*) FROM olt_mismatch_records m ${whereClause}
    `, params);
    const totalCount = Number(countResult.rows[0].count);

    // Get summary stats from olt_mismatch_records
    // Fixable = has correct ONT serial (olt_serial from column B) and still pending
    // Investigate = no correct serial OR not found in 1Map (moved to needs_investigation)
    const statsResult = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE fix_status = 'pending' AND olt_serial IS NOT NULL AND olt_serial != '') as pending,
        COUNT(*) FILTER (WHERE
          (fix_status = 'pending' AND (olt_serial IS NULL OR olt_serial = ''))
          OR fix_status = 'needs_investigation'
        ) as needs_investigation,
        COUNT(*) FILTER (WHERE fix_status = 'fixed') as fixed,
        COUNT(*) FILTER (WHERE fix_status = 'empty_serial') as empty,
        COUNT(*) as total
      FROM olt_mismatch_records
    `);
    const stats = {
      pending: Number(statsResult.rows[0].pending) || 0,
      needs_investigation: Number(statsResult.rows[0].needs_investigation) || 0,
      fixed: Number(statsResult.rows[0].fixed) || 0,
      empty: Number(statsResult.rows[0].empty) || 0,
      total: Number(statsResult.rows[0].total) || 0,
    };

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

/**
 * OLT Report Reporting API
 *
 * GET: Get reporting data with time filters
 *
 * Query params:
 * - period: 'today' | 'yesterday' | 'week' | '30days' | 'all' (default: 'all')
 * - format: 'json' | 'csv' (default: 'json')
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

type Period = 'today' | 'yesterday' | 'week' | '30days' | 'all';

function getDateRange(period: Period): { start: Date | null; end: Date | null } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case 'today':
      return { start: today, end: null };
    case 'yesterday': {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return { start: yesterday, end: today };
    }
    case 'week': {
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return { start: weekAgo, end: null };
    }
    case '30days': {
      const monthAgo = new Date(today);
      monthAgo.setDate(monthAgo.getDate() - 30);
      return { start: monthAgo, end: null };
    }
    case 'all':
    default:
      return { start: null, end: null };
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const client = await pool.connect();

  try {
    const period = (req.query.period as Period) || 'all';
    const format = (req.query.format as string) || 'json';
    const { start, end } = getDateRange(period);

    // Build date condition
    let dateCondition = '';
    const params: (string | Date)[] = [];
    let paramIndex = 1;

    if (start) {
      dateCondition = `AND m.created_at >= $${paramIndex}`;
      params.push(start.toISOString());
      paramIndex++;
    }
    if (end) {
      dateCondition += ` AND m.created_at < $${paramIndex}`;
      params.push(end.toISOString());
      paramIndex++;
    }

    // Get all records with details
    const recordsResult = await client.query(`
      SELECT
        m.id,
        m.drop_number,
        m.olt_serial,
        m.wrong_onemap_serial,
        m.fix_status,
        m.fix_result,
        m.fix_old_value,
        m.fix_attempted_at,
        m.created_at,
        i.filename as import_filename,
        i.project,
        i.imported_at,
        CONCAT(u_import.first_name, ' ', u_import.last_name) as imported_by,
        CONCAT(u_fix.first_name, ' ', u_fix.last_name) as fixed_by
      FROM olt_mismatch_records m
      LEFT JOIN olt_report_imports i ON m.import_id = i.id
      LEFT JOIN users u_import ON i.imported_by = u_import.id
      LEFT JOIN users u_fix ON m.fix_by = u_fix.id
      WHERE 1=1 ${dateCondition}
      ORDER BY m.created_at DESC
    `, params);

    // Calculate summary stats
    const records = recordsResult.rows;
    const summary = {
      total: records.length,
      fixed: records.filter(r => r.fix_status === 'fixed').length,
      pending: records.filter(r => r.fix_status === 'pending').length,
      empty_serial: records.filter(r => r.fix_status === 'empty_serial').length,
      not_found: records.filter(r => r.fix_status === 'not_found').length,
      needs_reinvestigation: records.filter(r => r.fix_status === 'needs_reinvestigation').length,
    };

    // Get fixes by day for chart
    const fixesByDayResult = await client.query(`
      SELECT
        DATE(fix_attempted_at) as date,
        COUNT(*) as count
      FROM olt_mismatch_records
      WHERE fix_status = 'fixed'
        AND fix_attempted_at IS NOT NULL
        ${start ? `AND fix_attempted_at >= $${params.length + 1}` : ''}
      GROUP BY DATE(fix_attempted_at)
      ORDER BY date DESC
      LIMIT 30
    `, start ? [...params, start.toISOString()] : params);

    // Get imports summary
    const importsResult = await client.query(`
      SELECT
        i.id,
        i.filename,
        i.project,
        i.total_records,
        i.mismatch_count,
        i.imported_at,
        COUNT(CASE WHEN m.fix_status = 'fixed' THEN 1 END) as fixed_count,
        COUNT(CASE WHEN m.fix_status = 'pending' THEN 1 END) as pending_count
      FROM olt_report_imports i
      LEFT JOIN olt_mismatch_records m ON m.import_id = i.id
      WHERE 1=1 ${start ? `AND i.imported_at >= $${params.length + 1}` : ''}
      GROUP BY i.id, i.filename, i.project, i.total_records, i.mismatch_count, i.imported_at
      ORDER BY i.imported_at DESC
    `, start ? [...params, start.toISOString()] : params);

    // CSV Export
    if (format === 'csv') {
      // Helper to safely escape CSV values
      const escapeCSV = (val: unknown): string => {
        const str = String(val ?? '');
        // Escape quotes by doubling them
        return `"${str.replace(/"/g, '""')}"`;
      };

      // Helper to format date safely
      const formatDate = (val: unknown): string => {
        if (!val) return '';
        try {
          return new Date(val as string).toISOString();
        } catch {
          return '';
        }
      };

      const csvRows = [
        ['DR Number', 'ONT Serial (Correct)', '1Map Serial (Wrong)', 'Status', 'Old Value', 'Fixed At', 'Import File', 'Project', 'Imported At', 'Fixed By'].join(','),
        ...records.map(r => [
          escapeCSV(r.drop_number),
          escapeCSV(r.olt_serial),
          escapeCSV(r.wrong_onemap_serial),
          escapeCSV(r.fix_status),
          escapeCSV(r.fix_old_value),
          escapeCSV(formatDate(r.fix_attempted_at)),
          escapeCSV(r.import_filename),
          escapeCSV(r.project),
          escapeCSV(formatDate(r.imported_at)),
          escapeCSV(r.fixed_by)
        ].join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=olt-report-${period}-${new Date().toISOString().split('T')[0]}.csv`);
      return res.send(csvRows);
    }

    return apiResponse.success(res, {
      period,
      dateRange: { start: start?.toISOString() || null, end: end?.toISOString() || null },
      summary,
      records,
      fixesByDay: fixesByDayResult.rows,
      imports: importsResult.rows,
    });
  } catch (error) {
    log.error('OltReportReporting', 'Failed to fetch reporting data', { error });
    return apiResponse.internalError(res, error);
  } finally {
    client.release();
  }
}

export default withAuth(withRole('manager')(handler));

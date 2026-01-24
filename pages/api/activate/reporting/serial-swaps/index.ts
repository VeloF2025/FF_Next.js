/**
 * Serial Swaps Report API
 *
 * GET: Fetch serial swap records with filters and pagination
 *
 * Query params:
 * - dateFrom, dateTo: Date range for detection
 * - project: Filter by project
 * - status: Filter by swap status
 * - page, pageSize: Pagination
 * - format: 'json' (default) or 'csv'
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth';
import { log } from '@/lib/logger';
import type {
  SerialSwapReportResponse,
  SerialSwapRecord,
  SerialSwapSummary,
  SwapStatus,
} from '@/modules/activate/types/reporting.types';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, ['GET']);
  }

  try {
    const {
      dateFrom,
      dateTo,
      project,
      status,
      page = '1',
      pageSize = '50',
      format = 'json',
    } = req.query;

    // Validate required params
    if (!dateFrom || !dateTo) {
      return apiResponse.badRequest(res, 'dateFrom and dateTo are required');
    }

    const pageNum = parseInt(page as string, 10);
    const pageSizeNum = parseInt(pageSize as string, 10);
    const offset = (pageNum - 1) * pageSizeNum;

    // Build WHERE clause
    const conditions: string[] = ['serial_swap_detected = true'];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    conditions.push(`serial_swap_detected_at >= $${paramIndex}::date`);
    params.push(dateFrom as string);
    paramIndex++;

    conditions.push(`serial_swap_detected_at <= $${paramIndex}::date + interval '1 day'`);
    params.push(dateTo as string);
    paramIndex++;

    if (project) {
      conditions.push(`project = $${paramIndex}`);
      params.push(project as string);
      paramIndex++;
    }

    if (status) {
      conditions.push(`serial_swap_status = $${paramIndex}`);
      params.push(status as string);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Get summary statistics
    const summaryQuery = `
      SELECT
        COUNT(*) FILTER (WHERE serial_swap_detected = true) as total_detected,
        COUNT(*) FILTER (WHERE serial_swap_status = 'pending_correction') as pending_correction,
        COUNT(*) FILTER (WHERE serial_swap_status = 'corrected_in_1map') as corrected,
        COUNT(*) FILTER (WHERE serial_swap_status = 'false_positive') as false_positive,
        AVG(
          CASE
            WHEN serial_swap_status = 'corrected_in_1map' AND serial_swap_corrected_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (serial_swap_corrected_at - serial_swap_detected_at)) / 86400
          END
        ) as avg_resolution_days,
        COUNT(*) FILTER (
          WHERE serial_swap_status = 'pending_correction'
          AND serial_swap_detected_at < NOW() - interval '7 days'
        ) as backlog_over_7_days
      FROM dr_photo_unified_reviews
      WHERE serial_swap_detected = true
        AND serial_swap_detected_at >= $1::date
        AND serial_swap_detected_at <= $2::date + interval '1 day'
        ${project ? `AND project = $3` : ''}
    `;

    const summaryParams = project
      ? [dateFrom, dateTo, project]
      : [dateFrom, dateTo];

    const summaryResult = await pool.query(summaryQuery, summaryParams);
    const summaryRow = summaryResult.rows[0] || {};

    // Get by-project breakdown
    const byProjectQuery = `
      SELECT
        project,
        COUNT(*) FILTER (WHERE serial_swap_status = 'pending_correction') as pending,
        COUNT(*) FILTER (WHERE serial_swap_status = 'corrected_in_1map') as corrected,
        COUNT(*) as total
      FROM dr_photo_unified_reviews
      WHERE serial_swap_detected = true
        AND serial_swap_detected_at >= $1::date
        AND serial_swap_detected_at <= $2::date + interval '1 day'
      GROUP BY project
      ORDER BY total DESC
    `;

    const byProjectResult = await pool.query(byProjectQuery, [dateFrom, dateTo]);
    const byProject: Record<string, { pending: number; corrected: number; total: number }> = {};
    for (const row of byProjectResult.rows) {
      if (row.project) {
        byProject[row.project] = {
          pending: Number(row.pending) || 0,
          corrected: Number(row.corrected) || 0,
          total: Number(row.total) || 0,
        };
      }
    }

    const summary: SerialSwapSummary = {
      total_detected: Number(summaryRow.total_detected) || 0,
      pending_correction: Number(summaryRow.pending_correction) || 0,
      corrected: Number(summaryRow.corrected) || 0,
      false_positive: Number(summaryRow.false_positive) || 0,
      avg_resolution_days: summaryRow.avg_resolution_days
        ? Math.round(Number(summaryRow.avg_resolution_days) * 10) / 10
        : null,
      backlog_over_7_days: Number(summaryRow.backlog_over_7_days) || 0,
      by_project: byProject,
    };

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as count
      FROM dr_photo_unified_reviews
      WHERE ${whereClause}
    `;
    const countResult = await pool.query(countQuery, params);
    const totalCount = Number(countResult.rows[0]?.count) || 0;

    // Get paginated records
    const recordsQuery = `
      SELECT
        u.drop_number,
        u.project,
        d.zone_no,
        d.pon_no,
        u.ont_serial_scanned as ont_serial,
        u.ups_serial_scanned as ups_serial,
        u.serial_swap_details as swap_details,
        u.serial_swap_status as swap_status,
        u.serial_swap_detected_at as detected_at,
        u.serial_swap_corrected_at as corrected_at,
        u.serial_swap_corrected_by as corrected_by,
        q.submitted_by as technician_name,
        q.sender_phone as technician_phone,
        EXTRACT(EPOCH FROM (NOW() - u.serial_swap_detected_at)) / 86400 as days_pending
      FROM dr_photo_unified_reviews u
      LEFT JOIN drops d ON u.drop_number = d.drop_number
      LEFT JOIN qa_photo_reviews q ON u.drop_number = q.drop_number
      WHERE ${whereClause}
      ORDER BY
        CASE WHEN u.serial_swap_status = 'pending_correction' THEN 0 ELSE 1 END,
        u.serial_swap_detected_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const recordsResult = await pool.query(recordsQuery, [...params, pageSizeNum, offset]);

    const records: SerialSwapRecord[] = recordsResult.rows.map((row) => ({
      drop_number: row.drop_number,
      project: row.project,
      zone_no: row.zone_no ? Number(row.zone_no) : null,
      pon_no: row.pon_no ? Number(row.pon_no) : null,
      ont_serial: row.ont_serial,
      ups_serial: row.ups_serial,
      swap_details: row.swap_details || 'Serials appear to be swapped',
      swap_status: (row.swap_status || 'pending_correction') as SwapStatus,
      detected_at: row.detected_at?.toISOString() || new Date().toISOString(),
      corrected_at: row.corrected_at?.toISOString() || null,
      corrected_by: row.corrected_by,
      technician_name: row.technician_name,
      technician_phone: row.technician_phone,
      days_pending: Math.floor(Number(row.days_pending) || 0),
    }));

    // Handle CSV export
    if (format === 'csv') {
      const csvRows = [
        ['DR Number', 'Project', 'ONT Serial', 'UPS Serial', 'Swap Details', 'Status', 'Detected At', 'Days Pending'].join(','),
        ...records.map((r) =>
          [
            r.drop_number,
            r.project || '',
            r.ont_serial || '',
            r.ups_serial || '',
            `"${(r.swap_details || '').replace(/"/g, '""')}"`,
            r.swap_status,
            r.detected_at?.split('T')[0] || '',
            r.days_pending,
          ].join(',')
        ),
      ];

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=serial-swaps-${dateFrom}-to-${dateTo}.csv`);
      return res.status(200).send(csvRows.join('\n'));
    }

    const response: SerialSwapReportResponse = {
      date_range: {
        from: dateFrom as string,
        to: dateTo as string,
      },
      project: (project as string) || null,
      summary,
      records,
      total_count: totalCount,
      page: pageNum,
      page_size: pageSizeNum,
      available_statuses: ['pending_correction', 'corrected_in_1map', 'false_positive'],
    };

    log.info('SerialSwapsReport', `Fetched ${records.length} swap records`, {
      dateFrom,
      dateTo,
      project,
      status,
      totalCount,
    });

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('SerialSwapsReport', 'Failed to fetch serial swaps report', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('manager')(handler));

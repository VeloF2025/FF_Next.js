/**
 * API Route: /api/activate/import-pp-data
 *
 * Purpose: Query OES PP (Pre-Provision) data - ONT serials placed on network before activation
 * PP data is automatically imported during OES import (import-oes.ts).
 *
 * Methods:
 * - GET ?action=stats: Summary statistics
 * - GET ?action=list: Paginated list of PP data records
 * - GET ?action=export: Excel export (respects project/status filters)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';

import * as XLSX from 'xlsx';
import { withAuth, withRole } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';
import pool from '@/lib/db';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET','POST','PUT','DELETE','PATCH']);
  }

  const action = req.query.action as string;

  if (action === 'stats') {
    const statsResult = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE resolution_status = 'activated') as activated,
        COUNT(*) FILTER (WHERE resolution_status LIKE 'located_%') as located,
        COUNT(*) FILTER (WHERE resolution_status = 'not_found') as not_found,
        COUNT(DISTINCT project) as projects,
        COUNT(*) FILTER (WHERE maintenance_ticket_id IS NOT NULL) as ticketed
      FROM oes_pp_data
    `);

    const lastImportResult = await pool.query(`
      SELECT created_at, filename, total_rows
      FROM oes_pp_import_batches
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const stats = statsResult.rows[0];
    const lastImport = lastImportResult.rows[0] || null;

    return apiResponse.success(res, {
      total: parseInt(stats.total, 10),
      activated: parseInt(stats.activated, 10),
      located: parseInt(stats.located, 10),
      notFound: parseInt(stats.not_found, 10),
      projects: parseInt(stats.projects, 10),
      ticketed: parseInt(stats.ticketed, 10),
      lastImport: lastImport
        ? {
            date: lastImport.created_at,
            filename: lastImport.filename,
            totalRows: lastImport.total_rows,
          }
        : null,
    });
  }

  if (action === 'list') {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 1000);
    const offset = (page - 1) * limit;
    const project = req.query.project as string;
    const status = req.query.status as string;
    const dateFrom = req.query.dateFrom as string;
    const dateTo = req.query.dateTo as string;

    let whereClause = '';
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (project) {
      whereClause += ` AND pp.project = $${paramIndex++}`;
      params.push(project);
    }
    if (status) {
      whereClause += ` AND pp.resolution_status = $${paramIndex++}`;
      params.push(status);
    }
    if (dateFrom) {
      whereClause += ` AND pp.date_registered >= $${paramIndex++}::date`;
      params.push(dateFrom);
    }
    if (dateTo) {
      whereClause += ` AND pp.date_registered <= $${paramIndex++}::date`;
      params.push(dateTo);
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM oes_pp_data pp WHERE 1=1${whereClause}`,
      params
    );

    const dataResult = await pool.query(
      `SELECT pp.*, mt.ticket_uid
       FROM oes_pp_data pp
       LEFT JOIN maintenance_tickets mt ON pp.maintenance_ticket_id = mt.id
       WHERE 1=1${whereClause}
       ORDER BY pp.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, limit, offset]
    );

    // Frontend expects: data.data = records[], data.pagination = {...}
    // apiResponse.success wraps as { success: true, data: <payload> }
    // So we send records as a flat response and pagination alongside
    const total = parseInt(countResult.rows[0].total, 10);
    return res.status(200).json({
      success: true,
      data: dataResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }

  if (action === 'export') {
    const project = req.query.project as string;
    const status = req.query.status as string;
    const exportDateFrom = req.query.dateFrom as string;
    const exportDateTo = req.query.dateTo as string;

    let whereClause = '';
    const params: string[] = [];
    let paramIndex = 1;

    if (project) {
      whereClause += ` AND project = $${paramIndex++}`;
      params.push(project);
    }
    if (status) {
      whereClause += ` AND resolution_status = $${paramIndex++}`;
      params.push(status);
    }
    if (exportDateFrom) {
      whereClause += ` AND date_registered >= $${paramIndex++}::date`;
      params.push(exportDateFrom);
    }
    if (exportDateTo) {
      whereClause += ` AND date_registered <= $${paramIndex++}::date`;
      params.push(exportDateTo);
    }

    const dataResult = await pool.query(
      `SELECT serial_number, project, date_registered, resolution_status,
              resolved_drop_number, resolved_source, resolved_at
       FROM oes_pp_data
       WHERE 1=1${whereClause}
       ORDER BY project, resolution_status, serial_number`,
      params
    );

    const STATUS_LABELS: Record<string, string> = {
      not_found: 'Not Found',
      located_oes: 'Found (OES)',
      located_unified: 'Found (Unified)',
      located_onemap: 'Found (OneMap)',
      located_1map: 'Found (1Map)',
      located_local: 'Found (Local)',
      activated: 'Activated',
    };

    const rows = dataResult.rows.map(r => ({
      'Serial Number': r.serial_number,
      'Project': r.project,
      'Date Registered': r.date_registered ? new Date(r.date_registered).toLocaleDateString() : '',
      'Status': STATUS_LABELS[r.resolution_status] || r.resolution_status,
      'Resolved DR': r.resolved_drop_number || '',
      'Source': r.resolved_source || '',
      'Resolved At': r.resolved_at ? new Date(r.resolved_at).toLocaleString() : '',
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);

    // Set column widths
    ws['!cols'] = [
      { wch: 20 }, // Serial Number
      { wch: 12 }, // Project
      { wch: 14 }, // Date Registered
      { wch: 14 }, // Status
      { wch: 14 }, // Resolved DR
      { wch: 22 }, // Source
      { wch: 20 }, // Resolved At
    ];

    const sheetName = status
      ? `PP Data - ${STATUS_LABELS[status] || status}`
      : project
        ? `PP Data - ${project}`
        : 'PP Data';
    XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const fileParts = ['PP_Data'];
    if (project) fileParts.push(project);
    if (status) fileParts.push(status);
    fileParts.push(new Date().toISOString().substring(0, 10));
    const filename = `${fileParts.join('_')}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);
  }

  if (action === 'lookup-status') {
    const result = await pool.query(`
      SELECT id, status, started_at, completed_at, details
      FROM data_sync_operations
      WHERE operation_type = 'pp_data_1map_lookup'
      ORDER BY started_at DESC
      LIMIT 1
    `);

    const row = result.rows[0] || null;

    // Detect stale "running" jobs (server restart killed the background process)
    // A job is stale if: running for > 10 minutes, OR progress hasn't changed in > 3 minutes
    if (row && row.status === 'running') {
      const details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details || {};
      const startedAt = new Date(row.started_at).getTime();
      const elapsedMs = Date.now() - startedAt;
      const TEN_MINUTES = 10 * 60 * 1000;

      if (elapsedMs > TEN_MINUTES) {
        await pool.query(
          `UPDATE data_sync_operations SET status = 'failed', completed_at = NOW(),
           details = details || '{"stale": true}'::jsonb WHERE id = $1`,
          [row.id]
        );
        row.status = 'failed';
        row.completed_at = new Date();
      } else if (details.elapsed_seconds && elapsedMs > (details.elapsed_seconds * 1000) + 180000) {
        // DB progress hasn't updated in 3+ minutes (elapsed_seconds from last DB write vs wall clock)
        await pool.query(
          `UPDATE data_sync_operations SET status = 'failed', completed_at = NOW(),
           details = details || '{"stale": true}'::jsonb WHERE id = $1`,
          [row.id]
        );
        row.status = 'failed';
        row.completed_at = new Date();
      }
    }

    return apiResponse.success(res, row
      ? {
          status: row.status,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          ...(typeof row.details === 'string' ? JSON.parse(row.details) : row.details || {}),
        }
      : null,
    );
  }

  return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
}

export default withAuth(withErrorHandler(withRole('manager')(handler)));

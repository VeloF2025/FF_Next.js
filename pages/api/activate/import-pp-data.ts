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

import ExcelJS from 'exceljs';
import { withAuth, withRole } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';
import pool from '@/lib/db';
import { getOrCreateShareUrls } from '@/modules/noc/services/ticketShareLinks';
import { gpsCoordinates, applyTicketRowLinks } from '@/lib/excel/ticketLinkCells';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET','POST','PUT','DELETE','PATCH']);
  }

  const action = req.query.action as string;

  if (action === 'stats') {
    // Apply the same filter set as list (except status, so each card reflects
    // its own status count against the same project/date/priority/etc. scope).
    const project = req.query.project as string;
    const status = req.query.status as string;
    const priority = req.query.priority as string;
    const aging = req.query.aging as string;
    const dateFrom = req.query.dateFrom as string;
    const dateTo = req.query.dateTo as string;
    const search = ((req.query.search as string) || '').trim();
    const pon = req.query.pon as string;

    let whereClause = '';
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (project) {
      whereClause += ` AND pp.project = $${paramIndex++}`;
      params.push(project);
    }
    if (status === 'unticketed') {
      whereClause += ` AND pp.maintenance_ticket_id IS NULL AND pp.resolution_status != 'activated'`;
    } else if (status === 'located') {
      whereClause += ` AND pp.resolution_status LIKE 'located_%'`;
    } else if (status === 'ticketed') {
      whereClause += ` AND pp.maintenance_ticket_id IS NOT NULL`;
    } else if (status) {
      whereClause += ` AND pp.resolution_status = $${paramIndex++}`;
      params.push(status);
    }
    // Aging implies high priority; if both supplied, aging wins to avoid a
    // double `mt.priority = X` AND-clause that would never match.
    const effectivePriority = aging ? 'high' : priority;
    if (effectivePriority) {
      whereClause += ` AND mt.priority = $${paramIndex++}`;
      params.push(effectivePriority);
    }
    if (aging === 'recent') {
      whereClause += ` AND mt.created_at >= NOW() - $${paramIndex++}::interval`;
      params.push('6 days');
    } else if (aging === '7days') {
      whereClause += ` AND mt.created_at >= NOW() - $${paramIndex++}::interval AND mt.created_at < NOW() - $${paramIndex++}::interval`;
      params.push('13 days', '6 days');
    } else if (aging === '14days') {
      whereClause += ` AND mt.created_at < NOW() - $${paramIndex++}::interval`;
      params.push('13 days');
    }
    if (dateFrom) {
      whereClause += ` AND pp.date_registered >= $${paramIndex++}::date`;
      params.push(dateFrom);
    }
    if (dateTo) {
      whereClause += ` AND pp.date_registered <= $${paramIndex++}::date`;
      params.push(dateTo);
    }
    if (search) {
      // One bound param reused across three ILIKE checks → push once, then
      // single increment (intentional deferred ++ — matches the list branch).
      whereClause += ` AND (pp.serial_number ILIKE $${paramIndex} OR pp.resolved_drop_number ILIKE $${paramIndex} OR mt.ticket_uid ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (pon) {
      const ponNum = parseInt(pon, 10);
      if (!isNaN(ponNum)) {
        whereClause += ` AND pp.olt_pon = $${paramIndex++}`;
        params.push(ponNum);
      }
    }

    const statsResult = await pool.query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE pp.resolution_status = 'activated') as activated,
        COUNT(*) FILTER (WHERE pp.resolution_status LIKE 'located_%') as located,
        COUNT(*) FILTER (WHERE pp.resolution_status = 'not_found') as not_found,
        COUNT(DISTINCT pp.project) as projects,
        COUNT(*) FILTER (WHERE pp.maintenance_ticket_id IS NOT NULL) as ticketed,
        COUNT(*) FILTER (WHERE pp.maintenance_ticket_id IS NULL AND pp.resolution_status != 'activated') as unticketed
      FROM oes_pp_data pp
      LEFT JOIN maintenance_tickets mt ON pp.maintenance_ticket_id = mt.id
      WHERE 1=1${whereClause}`,
      params,
    );

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
      unticketed: parseInt(stats.unticketed, 10),
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
    const search = (req.query.search as string || '').trim();
    const priority = req.query.priority as string;
    const aging = req.query.aging as string;
    const pon = req.query.pon as string;

    let whereClause = '';
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (project) {
      whereClause += ` AND pp.project = $${paramIndex++}`;
      params.push(project);
    }
    if (status === 'unticketed') {
      whereClause += ` AND pp.maintenance_ticket_id IS NULL AND pp.resolution_status != 'activated'`;
    } else if (status === 'located') {
      whereClause += ` AND pp.resolution_status LIKE 'located_%'`;
    } else if (status === 'ticketed') {
      whereClause += ` AND pp.maintenance_ticket_id IS NOT NULL`;
    } else if (status) {
      whereClause += ` AND pp.resolution_status = $${paramIndex++}`;
      params.push(status);
    }
    // When aging is active it implies priority = 'high', so override any separate
    // priority param to avoid a conflicting AND mt.priority = X double-clause.
    const effectivePriority = aging ? 'high' : priority;
    if (effectivePriority) {
      whereClause += ` AND mt.priority = $${paramIndex++}`;
      params.push(effectivePriority);
    }

    if (aging) {
      // Each aging bucket is expressed as a half-open date interval so Postgres
      // can use an index on mt.created_at.  All boundaries are parameterized.
      if (aging === 'recent') {
        // 0-6 days old: created_at >= NOW() - 6 days
        whereClause += ` AND mt.created_at >= NOW() - $${paramIndex++}::interval`;
        params.push('6 days');
      } else if (aging === '7days') {
        // 7-13 days old: created_at in [NOW()-13d, NOW()-6d)
        whereClause += ` AND mt.created_at >= NOW() - $${paramIndex++}::interval AND mt.created_at < NOW() - $${paramIndex++}::interval`;
        params.push('13 days', '6 days');
      } else if (aging === '14days') {
        // 14+ days old: created_at < NOW() - 13 days
        whereClause += ` AND mt.created_at < NOW() - $${paramIndex++}::interval`;
        params.push('13 days');
      }
    }
    if (aging) {
      // Aging filter: force high priority and filter by ticket age bucket
      whereClause += ` AND mt.priority = 'high'`;
      if (aging === 'recent') {
        whereClause += ` AND mt.created_at >= NOW() - INTERVAL '6 days'`;
      } else if (aging === '7days') {
        whereClause += ` AND mt.created_at >= NOW() - INTERVAL '13 days' AND mt.created_at < NOW() - INTERVAL '6 days'`;
      } else if (aging === '14days') {
        whereClause += ` AND mt.created_at < NOW() - INTERVAL '13 days'`;
      }
    }
    if (aging) {
      // Aging filter: filter by ticket age bucket only, priority is handled separately
      if (aging === 'recent') {
        whereClause += ` AND mt.created_at >= NOW() - INTERVAL '6 days'`;
      } else if (aging === '7days') {
        whereClause += ` AND mt.created_at >= NOW() - INTERVAL '13 days' AND mt.created_at < NOW() - INTERVAL '6 days'`;
      } else if (aging === '14days') {
        whereClause += ` AND mt.created_at < NOW() - INTERVAL '13 days'`;
      }
    }
    if (dateFrom) {
      whereClause += ` AND pp.date_registered >= $${paramIndex++}::date`;
      params.push(dateFrom);
    }
    if (dateTo) {
      whereClause += ` AND pp.date_registered <= $${paramIndex++}::date`;
      params.push(dateTo);
    }
    if (search) {
      whereClause += ` AND (pp.serial_number ILIKE $${paramIndex} OR pp.resolved_drop_number ILIKE $${paramIndex} OR mt.ticket_uid ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (pon) {
      const ponNum = parseInt(pon, 10);
      if (!isNaN(ponNum)) {
        whereClause += ` AND pp.olt_pon = $${paramIndex++}`;
        params.push(ponNum);
      }
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM oes_pp_data pp
       LEFT JOIN maintenance_tickets mt ON pp.maintenance_ticket_id = mt.id
       WHERE 1=1${whereClause}`,
      params
    );

    const dataResult = await pool.query(
      `WITH eod_match AS (
         SELECT DISTINCT ON (e.dr_number)
                e.dr_number,
                s.technician_name AS eod_technician_name,
                s.velocity_rep_name AS eod_velocity_rep_name,
                s.sheet_date AS eod_sheet_date
         FROM eod_install_sheet_entries e
         JOIN eod_install_sheets s ON s.id = e.sheet_id
         WHERE e.dr_number IS NOT NULL
         ORDER BY e.dr_number, s.sheet_date DESC NULLS LAST, e.id DESC
       )
       SELECT pp.*, mt.ticket_uid, mt.priority AS ticket_priority, mt.created_at AS ticket_created_at,
              COALESCE(oa.team, d.installed_by_name, wc.team, em.eod_velocity_rep_name) AS oes_team,
              -- Activation: strict OES activation date. Blank until OES has logged the
              -- activation. WA/EOD submission dates are NOT used as fallback — those are
              -- "located" signals, not real activations.
              oa.activation_date AS activation_date,
              dur.sender_phone AS wa_phone,
              COALESCE(wc.formal_name, wc.wa_display_name, em.eod_technician_name) AS wa_name,
              CASE
                WHEN wc.formal_name IS NOT NULL OR wc.wa_display_name IS NOT NULL THEN 'wa'
                WHEN em.eod_technician_name IS NOT NULL THEN 'eod'
                ELSE NULL
              END AS technician_source,
              wc.team AS wa_team,
              d.zone_no,
              d.pon_no
       FROM oes_pp_data pp
       LEFT JOIN maintenance_tickets mt ON pp.maintenance_ticket_id = mt.id
       LEFT JOIN oes_activations oa ON oa.drop_number = pp.resolved_drop_number
       LEFT JOIN drops d ON d.drop_number = pp.resolved_drop_number
       LEFT JOIN dr_photo_unified_reviews dur ON dur.drop_number = pp.resolved_drop_number
       LEFT JOIN wa_contacts wc ON wc.sender_phone = dur.sender_phone
       LEFT JOIN eod_match em ON em.dr_number = pp.resolved_drop_number
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
    const exportPriority = req.query.priority as string;
    const exportDateFrom = req.query.dateFrom as string;
    const exportDateTo = req.query.dateTo as string;

    let whereClause = '';
    const params: string[] = [];
    let paramIndex = 1;

    if (project) {
      whereClause += ` AND pp.project = $${paramIndex++}`;
      params.push(project);
    }
    if (status === 'unticketed') {
      whereClause += ` AND pp.maintenance_ticket_id IS NULL AND pp.resolution_status != 'activated'`;
    } else if (status === 'located') {
      whereClause += ` AND pp.resolution_status LIKE 'located_%'`;
    } else if (status === 'ticketed') {
      whereClause += ` AND pp.maintenance_ticket_id IS NOT NULL`;
    } else if (status) {
      whereClause += ` AND pp.resolution_status = $${paramIndex++}`;
      params.push(status);
    }
    if (exportPriority) {
      whereClause += ` AND mt.priority = $${paramIndex++}`;
      params.push(exportPriority);
    }
    if (exportDateFrom) {
      whereClause += ` AND pp.date_registered >= $${paramIndex++}::date`;
      params.push(exportDateFrom);
    }
    if (exportDateTo) {
      whereClause += ` AND pp.date_registered <= $${paramIndex++}::date`;
      params.push(exportDateTo);
    }

    const dataResult = await pool.query(
      `WITH eod_match AS (
         SELECT DISTINCT ON (e.dr_number)
                e.dr_number,
                s.technician_name AS eod_technician_name,
                s.velocity_rep_name AS eod_velocity_rep_name,
                s.sheet_date AS eod_sheet_date
         FROM eod_install_sheet_entries e
         JOIN eod_install_sheets s ON s.id = e.sheet_id
         WHERE e.dr_number IS NOT NULL
         ORDER BY e.dr_number, s.sheet_date DESC NULLS LAST, e.id DESC
       )
       SELECT pp.serial_number, pp.project, pp.date_registered, pp.resolution_status,
              pp.resolved_drop_number, pp.resolved_source, pp.resolved_at, pp.first_resolved_at,
              pp.olt_address, pp.olt_port, pp.olt_pon, pp.olt_lt, pp.olt_ont_pos,
              mt.priority AS ticket_priority,
              COALESCE(oa.team, d.installed_by_name, wc.team, em.eod_velocity_rep_name) AS oes_team,
              -- Strict OES activation only — see comment in list query above.
              oa.activation_date AS activation_date,
              dur.sender_phone AS wa_phone,
              COALESCE(wc.formal_name, wc.wa_display_name, em.eod_technician_name) AS wa_name,
              CASE
                WHEN wc.formal_name IS NOT NULL OR wc.wa_display_name IS NOT NULL THEN 'wa'
                WHEN em.eod_technician_name IS NOT NULL THEN 'eod'
                ELSE NULL
              END AS technician_source,
              wc.team AS wa_team,
              d.zone_no,
              d.pon_no,
              d.pole_number,
              -- GPS: DR-resolved drops coords first, then the PP row's own
              -- coordinates (Fibertime sheet / resolve backfill) — same
              -- precedence as PP ticket creation, so not_found rows export GPS.
              COALESCE(d.latitude, pp.latitude) AS latitude,
              COALESCE(d.longitude, pp.longitude) AS longitude,
              mt.id AS ticket_id,
              mt.ticket_uid
       FROM oes_pp_data pp
       LEFT JOIN maintenance_tickets mt ON pp.maintenance_ticket_id = mt.id
       LEFT JOIN oes_activations oa ON oa.drop_number = pp.resolved_drop_number
       LEFT JOIN drops d ON d.drop_number = pp.resolved_drop_number
       LEFT JOIN dr_photo_unified_reviews dur ON dur.drop_number = pp.resolved_drop_number
       LEFT JOIN wa_contacts wc ON wc.sender_phone = dur.sender_phone
       LEFT JOIN eod_match em ON em.dr_number = pp.resolved_drop_number
       WHERE 1=1${whereClause}
       ORDER BY pp.project, pp.resolution_status, pp.serial_number`,
      params
    );

    // Resolve shareable NOC links for every linked ticket (batched, mints if missing)
    const ppShareUrls = await getOrCreateShareUrls(dataResult.rows.map((r) => r.ticket_id));

    const STATUS_LABELS: Record<string, string> = {
      not_found: 'Not Found',
      located_oes: 'Found (OES)',
      located_unified: 'Found (Unified)',
      located_onemap: 'Found (OneMap)',
      located_1map: 'Found (1Map)',
      located_local: 'Found (Local)',
      activated: 'Activated',
    };

    // 1-based worksheet column positions for the clickable link cells.
    const PP_GPS_COL = 9;
    const PP_TICKET_COL = 20;
    const PP_TICKET_LINK_COL = 21;

    const headers = [
      'Serial Number', 'Project', 'PP Date', 'Status', 'Resolved DR', 'Zone', 'PON', 'Pole',
      'GPS Coordinates', 'Source', 'Located Date', 'Resolved At', 'Install Team', 'Activation Date',
      'WA Technician', 'Technician Source', 'WA Phone', 'WA Team', 'Priority', 'Ticket Number',
      'Ticket Link', 'OLT Address', 'OLT Port', 'OLT PON', 'OLT LT', 'OLT ONT Pos',
    ];
    const fmtDate = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : '');
    const fmtDateTime = (v: unknown) => (v ? new Date(v as string).toISOString().replace('T', ' ').slice(0, 19) : '');

    const sheetName = status
      ? `PP Data - ${STATUS_LABELS[status] || status}`
      : project
        ? `PP Data - ${project}`
        : 'PP Data';

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName.substring(0, 31));
    sheet.columns = headers.map((header) => ({ header, width: Math.max(12, Math.min(40, header.length + 4)) }));
    sheet.getRow(1).font = { bold: true };

    for (const r of dataResult.rows) {
      const ticketLink = r.ticket_id ? ppShareUrls.get(r.ticket_id) ?? '' : '';
      const added = sheet.addRow([
        r.serial_number,
        r.project,
        fmtDate(r.date_registered),
        STATUS_LABELS[r.resolution_status] || r.resolution_status,
        r.resolved_drop_number || '',
        r.zone_no ?? '',
        r.pon_no ?? '',
        r.pole_number || '',
        gpsCoordinates(r.latitude, r.longitude),
        r.resolved_source || '',
        fmtDate(r.first_resolved_at),
        fmtDateTime(r.resolved_at),
        r.oes_team || '',
        fmtDate(r.activation_date),
        r.wa_name ? `${r.wa_name}${r.technician_source === 'eod' ? ' (EOD)' : ''}` : '',
        r.technician_source || '',
        r.wa_phone || '',
        r.wa_team || '',
        r.ticket_priority ? (r.ticket_priority === 'high' ? 'High' : 'Normal') : '',
        r.ticket_uid || '',
        ticketLink,
        r.olt_address || '',
        r.olt_port || '',
        r.olt_pon ?? '',
        r.olt_lt ?? '',
        r.olt_ont_pos ?? '',
      ]);

      applyTicketRowLinks(added, {
        ticketCol: PP_TICKET_COL, ticketId: r.ticket_id, ticketUid: r.ticket_uid,
        ticketLinkCol: PP_TICKET_LINK_COL, ticketLink,
        gpsCol: PP_GPS_COL, lat: r.latitude, lng: r.longitude,
      });
    }

    const buf = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

    const fileParts = ['PP_Data'];
    // Sanitize query-derived parts so they can't inject into the Content-Disposition header.
    if (project) fileParts.push(project.replace(/[^a-zA-Z0-9_-]/g, '_'));
    if (status) fileParts.push(status.replace(/[^a-zA-Z0-9_-]/g, '_'));
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

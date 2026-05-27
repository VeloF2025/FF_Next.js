/**
 * OLT Report Excel Export API
 *
 * GET: Export OLT Investigate records to .xlsx using the same filters as the tab.
 * Query params match /api/system/olt-report/records for the Investigate scope:
 * - subStatus: needs_investigation | not_found | empty_serial | rejected | other
 * - search: DR number or serial search
 * - project: single project name
 * - projects: pipe-delimited project names for multi-select
 * - dateFrom/dateTo: ISO date range
 *
 * Security note: status is intentionally forced to needs_investigation server-side
 * so direct API calls cannot broaden this Investigate export to all OLT records.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import ExcelJS from 'exceljs';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { getOrCreateShareUrls } from '@/modules/noc/services/ticketShareLinks';
import { gpsCoordinates, gpsMapsUrl, internalTicketUrl, setLinkCell } from '@/lib/excel/ticketLinkCells';

type QueryParam = string | string[] | undefined;
type SqlParam = string | string[];

interface OltExportRow {
  drop_number: string | null;
  project: string | null;
  olt_serial: string | null;
  wrong_onemap_serial: string | null;
  zone_no: number | null;
  pon_no: number | null;
  pole_number: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  fix_status: string | null;
  ticket_id: string | null;
  ticket_uid: string | null;
  ticket_link: string | null;
  installer_name: string | null;
  onemap_install_team: string | null;
  wa_activation_team: string | null;
  import_filename: string | null;
  import_date: string | null;
  created_at: string | null;
  fix_attempted_at: string | null;
  resolved_at: string | null;
  escalated_at: string | null;
  detection_source: string | null;
  resolution_type: string | null;
  resolution_notes: string | null;
  fix_result: string | null;
  fix_old_value: string | null;
  has_ups_swap: boolean | null;
  investigation_context: string | null;
}

function firstParam(value: QueryParam): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function appendStatusFilter(status: string, whereParts: string[]) {
  if (status === 'pending') {
    whereParts.push("r.fix_status = 'pending' AND r.olt_serial IS NOT NULL");
  } else if (status === 'needs_investigation') {
    whereParts.push("(r.fix_status IN ('not_found', 'needs_investigation', 'needs_reinvestigation', 'empty_serial', 'rejected') OR r.olt_serial IS NULL)");
  } else if (status === 'fixed') {
    whereParts.push("r.fix_status = 'fixed'");
  } else if (status === 'escalated') {
    whereParts.push("r.fix_status = 'escalated'");
  } else if (status === 'resolved') {
    whereParts.push("r.fix_status = 'resolved'");
  }
}

function appendSubStatusFilter(subStatus: string | null, whereParts: string[], params: SqlParam[]) {
  const validSubStatuses = ['needs_investigation', 'not_found', 'empty_serial', 'rejected', 'other'];
  if (!subStatus || !validSubStatuses.includes(subStatus)) return;

  if (subStatus === 'needs_investigation') {
    whereParts.push("r.fix_status IN ('needs_investigation', 'needs_reinvestigation')");
    return;
  }

  if (subStatus === 'other') {
    whereParts.push("(r.fix_status IS NULL OR r.fix_status NOT IN ('needs_investigation', 'needs_reinvestigation', 'not_found'))");
    return;
  }

  params.push(subStatus);
  whereParts.push(`r.fix_status = $${params.length}`);
}

function buildFilters(query: NextApiRequest['query']) {
  const params: SqlParam[] = [];
  const whereParts: string[] = [];
  appendStatusFilter('needs_investigation', whereParts);
  appendSubStatusFilter(firstParam(query.subStatus), whereParts, params);

  const search = firstParam(query.search)?.trim();
  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    whereParts.push(`(r.drop_number ILIKE $${idx} OR r.olt_serial ILIKE $${idx} OR r.wrong_onemap_serial ILIKE $${idx})`);
  }

  const dateFrom = firstParam(query.dateFrom);
  if (dateFrom) {
    params.push(dateFrom);
    whereParts.push(`COALESCE(r.fix_attempted_at, r.created_at) >= $${params.length}::timestamptz`);
  }

  const dateTo = firstParam(query.dateTo);
  if (dateTo) {
    params.push(dateTo);
    whereParts.push(`COALESCE(r.fix_attempted_at, r.created_at) < $${params.length}::timestamptz`);
  }

  const project = firstParam(query.project)?.trim();
  const projectsParam = firstParam(query.projects)?.trim();
  const projects = projectsParam
    ? projectsParam.split('|').map((name) => name.trim()).filter(Boolean)
    : [];

  if (projects.length > 0) {
    params.push(projects);
    whereParts.push(`COALESCE(i.project, p.project_name) = ANY($${params.length}::text[])`);
  } else if (project) {
    params.push(project);
    whereParts.push(`COALESCE(i.project, p.project_name) = $${params.length}`);
  }

  return {
    params,
    whereClause: whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '',
  };
}

function formatDate(value: string | null) {
  if (!value) return '';
  return new Date(value).toISOString().replace('T', ' ').slice(0, 19);
}

function investigationSummary(context: string | null) {
  if (!context) return '';
  try {
    const parsed = JSON.parse(context) as Record<string, unknown>;
    const wrongSerial = typeof parsed.wrongSerial === 'string' ? parsed.wrongSerial : '';
    const belongsToDr = typeof parsed.belongsToDr === 'string' ? parsed.belongsToDr : '';
    const belongsToTeam = typeof parsed.belongsToTeam === 'string' ? parsed.belongsToTeam : '';
    if (wrongSerial && belongsToDr) {
      return `${wrongSerial} belongs to ${belongsToDr}${belongsToTeam ? ` (${belongsToTeam})` : ''}`;
    }
  } catch {
    return '';
  }
  return '';
}

// 1-based worksheet column positions for the cells rendered as clickable links.
const GPS_COL = 8; // "GPS coordinates" → Google Maps
const TICKET_COL = 10; // "Ticket" → internal ticket page
const TICKET_LINK_COL = 11; // "Ticket Link" → public shareable page

async function toExcel(rows: OltExportRow[], filters: Record<string, string>): Promise<Buffer> {
  const headers = [
    'DR Number',
    'Project',
    'OLT Serial',
    '1Map Serial',
    'Zone',
    'PON',
    'POLE',
    'GPS coordinates',
    'Status',
    'Ticket',
    'Ticket Link',
    'Installer',
    '1Map Install Team',
    'WhatsApp Activation Team',
    'Detection Source',
    'Investigation Summary',
    'Import File',
    'Import Date',
    'Created At',
    'Fix Attempted At',
    'Resolved At',
    'Escalated At',
    'Resolution Type',
    'Resolution Notes',
    'Fix Result',
    'Previous Value',
    'UPS Swap',
  ];

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('OLT Export');
  sheet.columns = headers.map((header) => ({
    header,
    width: Math.max(14, Math.min(40, header.length + 6)),
  }));
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    const added = sheet.addRow([
      row.drop_number || '',
      row.project || '',
      row.olt_serial || '',
      row.wrong_onemap_serial || '',
      row.zone_no ?? '',
      row.pon_no ?? '',
      row.pole_number || '',
      gpsCoordinates(row.latitude, row.longitude),
      row.fix_status || '',
      row.ticket_uid || '',
      row.ticket_link || '',
      row.installer_name || '',
      row.onemap_install_team || '',
      row.wa_activation_team || '',
      row.detection_source || '',
      investigationSummary(row.investigation_context),
      row.import_filename || '',
      formatDate(row.import_date),
      formatDate(row.created_at),
      formatDate(row.fix_attempted_at),
      formatDate(row.resolved_at),
      formatDate(row.escalated_at),
      row.resolution_type || '',
      row.resolution_notes || '',
      row.fix_result || '',
      row.fix_old_value || '',
      row.has_ups_swap ? 'Yes' : 'No',
    ]);

    // Ticket → internal FibreFlow ticket page (sign-in required)
    if (row.ticket_id && row.ticket_uid) {
      setLinkCell(added.getCell(TICKET_COL), row.ticket_uid, internalTicketUrl(row.ticket_id), 'Open ticket in FibreFlow (sign-in required)');
    }
    // Ticket Link → public shareable page
    if (row.ticket_link) {
      setLinkCell(added.getCell(TICKET_LINK_COL), row.ticket_link, row.ticket_link, 'Open shareable ticket link');
    }
    // GPS coordinates → Google Maps
    const mapsUrl = gpsMapsUrl(row.latitude, row.longitude);
    if (mapsUrl) {
      setLinkCell(added.getCell(GPS_COL), gpsCoordinates(row.latitude, row.longitude), mapsUrl, 'Open in Google Maps');
    }
  }

  const filterSheet = workbook.addWorksheet('Filters');
  filterSheet.columns = [{ width: 18 }, { width: 60 }];
  filterSheet.addRow(['Exported At', new Date().toISOString()]);
  filterSheet.addRow(['Record Count', String(rows.length)]);
  for (const [key, value] of Object.entries(filters)) {
    filterSheet.addRow([key, value || 'All']);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as unknown as Buffer;
}

function safeFilenamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const filters = buildFilters(req.query);
    const result = await pool.query(`
      SELECT DISTINCT ON (r.id)
        r.drop_number,
        r.olt_serial,
        r.wrong_onemap_serial,
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
        mt.id as ticket_id,
        mt.ticket_uid,
        d.zone_no,
        d.pon_no,
        d.pole_number,
        d.latitude,
        d.longitude,
        i.filename as import_filename,
        i.imported_at as import_date,
        COALESCE(i.project, p.project_name) as project,
        NULLIF(COALESCE(d.installed_by_name, op.installer_name, dur.installer_name), '') as installer_name,
        NULLIF(COALESCE(d.raw_data->>'last_modified_install_by', d.raw_data->>'last_modified_install_by ', d.site_submitted_by), '') as onemap_install_team,
        NULLIF(COALESCE(dur.oes_team, wc.team), '') as wa_activation_team
      FROM olt_mismatch_records r
      LEFT JOIN olt_report_imports i ON r.import_id = i.id
      LEFT JOIN drops d ON r.drop_number = d.drop_number
      LEFT JOIN projects p ON d.project_id = p.id
      LEFT JOIN maintenance_tickets mt ON r.maintenance_ticket_id = mt.id
      LEFT JOIN dr_photo_unified_reviews dur ON dur.drop_number = r.drop_number
      LEFT JOIN wa_contacts wc ON wc.sender_phone = dur.sender_phone
      LEFT JOIN LATERAL (
        SELECT op.installer_name
        FROM onemap_properties op
        WHERE op.drop_number = r.drop_number
        ORDER BY op.updated_at DESC NULLS LAST, op.id DESC
        LIMIT 1
      ) op ON true
      ${filters.whereClause}
      ORDER BY r.id, r.created_at DESC, d.id DESC
    `, filters.params);

    const rows = result.rows as OltExportRow[];

    // Mint (or reuse) a public shareable link for every linked ticket — this is an
    // authenticated, on-demand server-side export, so minting here is intentional.
    const shareUrls = await getOrCreateShareUrls(rows.map((r) => r.ticket_id));
    for (const row of rows) {
      row.ticket_link = row.ticket_id ? shareUrls.get(row.ticket_id) ?? null : null;
    }

    const status = 'needs_investigation';
    const filterSummary: Record<string, string> = {
      Status: status,
      'Sub-status': firstParam(req.query.subStatus) || 'All',
      Projects: firstParam(req.query.projects) || firstParam(req.query.project) || 'All',
      Search: firstParam(req.query.search) || '',
      'Date from': firstParam(req.query.dateFrom) || '',
      'Date to': firstParam(req.query.dateTo) || '',
    };

    const excel = await toExcel(rows, filterSummary);
    const date = new Date().toISOString().slice(0, 10);
    const projectLabel = firstParam(req.query.projects) || firstParam(req.query.project) || 'all-projects';
    const filename = `olt-${safeFilenamePart(status)}-${safeFilenamePart(projectLabel)}-${rows.length}-records-${date}.xlsx`;

    log.info('Exporting OLT report records', { count: rows.length, status }, 'OltReportExportAPI');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Count', String(rows.length));
    return res.status(200).send(excel);
  } catch (error: unknown) {
    log.error('olt-report-export', { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

/**
 * Snag Query Helpers — Explicit SQL query branches for snag list queries.
 * Avoids conditional SQL fragments (Neon constraint).
 * Used by pages/api/snags/index.ts.
 *
 * All queries JOIN maintenance_tickets to surface noc_ticket_uid for the UI.
 */

import type { NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import type { Snag } from '@/modules/construction-qa/types/snag.types';

const sql = neon(process.env.DATABASE_URL!);

// ============================================================
// Query helpers: By Report
// ============================================================

export async function querySnagsByReport(
  res: NextApiResponse,
  reportId: string,
  status: string | undefined,
  category: string | undefined,
  severity: string | undefined,
  searchTerm: string | null,
  pageNum: number,
  pageSizeNum: number,
  offset: number
) {
  if (status && category && severity && searchTerm) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no) AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE s.report_id = ${reportId} AND s.status = ${status}
        AND s.category = ${category} AND s.severity = ${severity}
        AND s.description ILIKE ${searchTerm}
      ORDER BY s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total FROM snags WHERE report_id = ${reportId}
        AND status = ${status} AND category = ${category}
        AND severity = ${severity} AND description ILIKE ${searchTerm}
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (status && category && severity) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no) AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE s.report_id = ${reportId} AND s.status = ${status}
        AND s.category = ${category} AND s.severity = ${severity}
      ORDER BY s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total FROM snags WHERE report_id = ${reportId}
        AND status = ${status} AND category = ${category} AND severity = ${severity}
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (status && category) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no) AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE s.report_id = ${reportId} AND s.status = ${status} AND s.category = ${category}
      ORDER BY s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total FROM snags WHERE report_id = ${reportId}
        AND status = ${status} AND category = ${category}
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (status) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no) AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE s.report_id = ${reportId} AND s.status = ${status}
      ORDER BY s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total FROM snags WHERE report_id = ${reportId} AND status = ${status}
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  const rows = await sql`
    SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no) AS pole_pon_no
    FROM snags s
    LEFT JOIN users u ON u.id = s.assigned_to
    LEFT JOIN snag_reports sr ON sr.id = s.report_id
    LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
    LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
    WHERE s.report_id = ${reportId}
    ORDER BY s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
  ` as Snag[];
  const countRows = await sql`
    SELECT COUNT(*) AS total FROM snags WHERE report_id = ${reportId}
  ` as Array<{ total: string }>;
  return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
}

// ============================================================
// Query helpers: By Project
// ============================================================

export async function querySnagsByProject(
  res: NextApiResponse,
  projectId: string,
  status: string | undefined,
  category: string | undefined,
  severity: string | undefined,
  pageNum: number,
  pageSizeNum: number,
  offset: number
) {
  if (status && category && severity) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no) AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE s.project_id = ${projectId} AND s.status = ${status}
        AND s.category = ${category} AND s.severity = ${severity}
      ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total FROM snags WHERE project_id = ${projectId}
        AND status = ${status} AND category = ${category} AND severity = ${severity}
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (status && category) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no) AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE s.project_id = ${projectId} AND s.status = ${status} AND s.category = ${category}
      ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total FROM snags WHERE project_id = ${projectId}
        AND status = ${status} AND category = ${category}
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (status) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no) AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE s.project_id = ${projectId} AND s.status = ${status}
      ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total FROM snags WHERE project_id = ${projectId} AND status = ${status}
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  const rows = await sql`
    SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no) AS pole_pon_no
    FROM snags s
    LEFT JOIN users u ON u.id = s.assigned_to
    LEFT JOIN snag_reports sr ON sr.id = s.report_id
    LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
    LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
    WHERE s.project_id = ${projectId}
    ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
  ` as Snag[];
  const countRows = await sql`
    SELECT COUNT(*) AS total FROM snags WHERE project_id = ${projectId}
  ` as Array<{ total: string }>;
  return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
}

// ============================================================
// Query helpers: By Project + Zone/PON (deep-link filter)
// ============================================================

/**
 * Filter snags by project + optional zone_no and/or pon_no.
 * zone_no / pon_no are matched against the pole/drop joined values.
 * This is the query used when the user navigates from the summary hierarchy
 * via a zone or PON deep-link.
 */
export async function querySnagsByProjectAndZone(
  res: NextApiResponse,
  projectId: string,
  zoneNo: number | undefined,
  ponNo: number | undefined,
  status: string | undefined,
  pageNum: number,
  pageSizeNum: number,
  offset: number
) {
  const zoneVal = zoneNo ?? null;
  const ponVal  = ponNo  ?? null;

  if (zoneNo !== undefined && ponNo !== undefined && status) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name,
        sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid,
        COALESCE(pole.longitude, dr.latitude) AS pole_latitude,
        COALESCE(pole.latitude,  dr.longitude) AS pole_longitude,
        COALESCE(pole.zone_no,   dr.zone_no)  AS pole_zone_no,
        COALESCE(pole.pon_no,    dr.pon_no)   AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE s.project_id = ${projectId}
        AND COALESCE(pole.zone_no, dr.zone_no) = ${zoneVal}
        AND COALESCE(pole.pon_no,  dr.pon_no)  = ${ponVal}
        AND s.status = ${status}
      ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC
      LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total
      FROM snags s
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE s.project_id = ${projectId}
        AND COALESCE(pole.zone_no, dr.zone_no) = ${zoneVal}
        AND COALESCE(pole.pon_no,  dr.pon_no)  = ${ponVal}
        AND s.status = ${status}
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (zoneNo !== undefined && ponNo !== undefined) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name,
        sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid,
        COALESCE(pole.longitude, dr.latitude) AS pole_latitude,
        COALESCE(pole.latitude,  dr.longitude) AS pole_longitude,
        COALESCE(pole.zone_no,   dr.zone_no)  AS pole_zone_no,
        COALESCE(pole.pon_no,    dr.pon_no)   AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE s.project_id = ${projectId}
        AND COALESCE(pole.zone_no, dr.zone_no) = ${zoneVal}
        AND COALESCE(pole.pon_no,  dr.pon_no)  = ${ponVal}
      ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC
      LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total
      FROM snags s
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE s.project_id = ${projectId}
        AND COALESCE(pole.zone_no, dr.zone_no) = ${zoneVal}
        AND COALESCE(pole.pon_no,  dr.pon_no)  = ${ponVal}
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (zoneNo !== undefined && status) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name,
        sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid,
        COALESCE(pole.longitude, dr.latitude) AS pole_latitude,
        COALESCE(pole.latitude,  dr.longitude) AS pole_longitude,
        COALESCE(pole.zone_no,   dr.zone_no)  AS pole_zone_no,
        COALESCE(pole.pon_no,    dr.pon_no)   AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE s.project_id = ${projectId}
        AND COALESCE(pole.zone_no, dr.zone_no) = ${zoneVal}
        AND s.status = ${status}
      ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC
      LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total
      FROM snags s
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE s.project_id = ${projectId}
        AND COALESCE(pole.zone_no, dr.zone_no) = ${zoneVal}
        AND s.status = ${status}
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  // Zone-only (no PON, no status filter)
  const rows = await sql`
    SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name,
      sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid,
      COALESCE(pole.longitude, dr.latitude) AS pole_latitude,
      COALESCE(pole.latitude,  dr.longitude) AS pole_longitude,
      COALESCE(pole.zone_no,   dr.zone_no)  AS pole_zone_no,
      COALESCE(pole.pon_no,    dr.pon_no)   AS pole_pon_no
    FROM snags s
    LEFT JOIN users u ON u.id = s.assigned_to
    LEFT JOIN snag_reports sr ON sr.id = s.report_id
    LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
    LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
    LEFT JOIN drops dr ON dr.id = s.drop_id
    WHERE s.project_id = ${projectId}
      AND COALESCE(pole.zone_no, dr.zone_no) = ${zoneVal}
    ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC
    LIMIT ${pageSizeNum} OFFSET ${offset}
  ` as Snag[];
  const countRows = await sql`
    SELECT COUNT(*) AS total
    FROM snags s
    LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
    LEFT JOIN drops dr ON dr.id = s.drop_id
    WHERE s.project_id = ${projectId}
      AND COALESCE(pole.zone_no, dr.zone_no) = ${zoneVal}
  ` as Array<{ total: string }>;
  return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
}

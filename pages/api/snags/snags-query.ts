/**
 * Snag Query Helpers — Explicit SQL query branches for snag list queries.
 *
 * All filters use ANY(${arr}::text[]) / ANY(${arr}::int[]) so one SQL branch
 * handles both single-value and multi-value selections.
 *
 * We still keep explicit branches per filter-combo to avoid Neon's "no
 * conditional SQL fragments" pitfall (conditional tagged-template fragments
 * break Neon's query builder).
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
  statusArr: string[],
  categoryArr: string[],
  severityArr: string[],
  searchTerm: string | null,
  pageNum: number,
  pageSizeNum: number,
  offset: number
) {
  const hasStatus   = statusArr.length   > 0;
  const hasCategory = categoryArr.length > 0;
  const hasSeverity = severityArr.length > 0;
  const hasSearch   = !!searchTerm;

  if (hasStatus && hasCategory && hasSeverity && hasSearch) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, (tu.first_name || ' ' || tu.last_name) AS noc_ticket_assignee_name, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no, pb.pon_no) AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN users tu ON tu.id = mt.assigned_to
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.report_id = ${reportId}
        AND s.status = ANY(${statusArr}::text[])
        AND s.category = ANY(${categoryArr}::text[])
        AND s.severity = ANY(${severityArr}::text[])
        AND s.description ILIKE ${searchTerm}
      ORDER BY s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total FROM snags
      WHERE report_id = ${reportId}
        AND status = ANY(${statusArr}::text[])
        AND category = ANY(${categoryArr}::text[])
        AND severity = ANY(${severityArr}::text[])
        AND description ILIKE ${searchTerm}
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (hasStatus && hasCategory && hasSeverity) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, (tu.first_name || ' ' || tu.last_name) AS noc_ticket_assignee_name, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no, pb.pon_no) AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN users tu ON tu.id = mt.assigned_to
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.report_id = ${reportId}
        AND s.status = ANY(${statusArr}::text[])
        AND s.category = ANY(${categoryArr}::text[])
        AND s.severity = ANY(${severityArr}::text[])
      ORDER BY s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total FROM snags
      WHERE report_id = ${reportId}
        AND status = ANY(${statusArr}::text[])
        AND category = ANY(${categoryArr}::text[])
        AND severity = ANY(${severityArr}::text[])
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (hasStatus && hasCategory) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, (tu.first_name || ' ' || tu.last_name) AS noc_ticket_assignee_name, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no, pb.pon_no) AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN users tu ON tu.id = mt.assigned_to
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.report_id = ${reportId}
        AND s.status = ANY(${statusArr}::text[])
        AND s.category = ANY(${categoryArr}::text[])
      ORDER BY s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total FROM snags
      WHERE report_id = ${reportId}
        AND status = ANY(${statusArr}::text[])
        AND category = ANY(${categoryArr}::text[])
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (hasStatus) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, (tu.first_name || ' ' || tu.last_name) AS noc_ticket_assignee_name, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no, pb.pon_no) AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN users tu ON tu.id = mt.assigned_to
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.report_id = ${reportId} AND s.status = ANY(${statusArr}::text[])
      ORDER BY s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total FROM snags
      WHERE report_id = ${reportId} AND status = ANY(${statusArr}::text[])
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  const rows = await sql`
    SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, (tu.first_name || ' ' || tu.last_name) AS noc_ticket_assignee_name, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no, pb.pon_no) AS pole_pon_no
    FROM snags s
    LEFT JOIN users u ON u.id = s.assigned_to
    LEFT JOIN snag_reports sr ON sr.id = s.report_id
    LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
    LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
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
  statusArr: string[],
  categoryArr: string[],
  severityArr: string[],
  pageNum: number,
  pageSizeNum: number,
  offset: number
) {
  const hasStatus   = statusArr.length   > 0;
  const hasCategory = categoryArr.length > 0;
  const hasSeverity = severityArr.length > 0;

  if (hasStatus && hasCategory && hasSeverity) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, (tu.first_name || ' ' || tu.last_name) AS noc_ticket_assignee_name, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no, pb.pon_no) AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN users tu ON tu.id = mt.assigned_to
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.project_id = ${projectId}
        AND s.status = ANY(${statusArr}::text[])
        AND s.category = ANY(${categoryArr}::text[])
        AND s.severity = ANY(${severityArr}::text[])
      ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total FROM snags
      WHERE project_id = ${projectId}
        AND status = ANY(${statusArr}::text[])
        AND category = ANY(${categoryArr}::text[])
        AND severity = ANY(${severityArr}::text[])
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (hasStatus && hasCategory) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, (tu.first_name || ' ' || tu.last_name) AS noc_ticket_assignee_name, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no, pb.pon_no) AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN users tu ON tu.id = mt.assigned_to
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.project_id = ${projectId}
        AND s.status = ANY(${statusArr}::text[])
        AND s.category = ANY(${categoryArr}::text[])
      ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total FROM snags
      WHERE project_id = ${projectId}
        AND status = ANY(${statusArr}::text[])
        AND category = ANY(${categoryArr}::text[])
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (hasStatus && hasSeverity) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, (tu.first_name || ' ' || tu.last_name) AS noc_ticket_assignee_name, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no, pb.pon_no) AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN users tu ON tu.id = mt.assigned_to
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.project_id = ${projectId}
        AND s.status = ANY(${statusArr}::text[])
        AND s.severity = ANY(${severityArr}::text[])
      ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total FROM snags
      WHERE project_id = ${projectId}
        AND status = ANY(${statusArr}::text[])
        AND severity = ANY(${severityArr}::text[])
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (hasCategory && hasSeverity) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, (tu.first_name || ' ' || tu.last_name) AS noc_ticket_assignee_name, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no, pb.pon_no) AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN users tu ON tu.id = mt.assigned_to
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.project_id = ${projectId}
        AND s.category = ANY(${categoryArr}::text[])
        AND s.severity = ANY(${severityArr}::text[])
      ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total FROM snags
      WHERE project_id = ${projectId}
        AND category = ANY(${categoryArr}::text[])
        AND severity = ANY(${severityArr}::text[])
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (hasStatus) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, (tu.first_name || ' ' || tu.last_name) AS noc_ticket_assignee_name, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no, pb.pon_no) AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN users tu ON tu.id = mt.assigned_to
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.project_id = ${projectId} AND s.status = ANY(${statusArr}::text[])
      ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total FROM snags WHERE project_id = ${projectId} AND status = ANY(${statusArr}::text[])
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (hasCategory) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, (tu.first_name || ' ' || tu.last_name) AS noc_ticket_assignee_name, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no, pb.pon_no) AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN users tu ON tu.id = mt.assigned_to
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.project_id = ${projectId} AND s.category = ANY(${categoryArr}::text[])
      ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total FROM snags WHERE project_id = ${projectId} AND category = ANY(${categoryArr}::text[])
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (hasSeverity) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, (tu.first_name || ' ' || tu.last_name) AS noc_ticket_assignee_name, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no, pb.pon_no) AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN users tu ON tu.id = mt.assigned_to
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.project_id = ${projectId} AND s.severity = ANY(${severityArr}::text[])
      ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total FROM snags WHERE project_id = ${projectId} AND severity = ANY(${severityArr}::text[])
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  const rows = await sql`
    SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, (tu.first_name || ' ' || tu.last_name) AS noc_ticket_assignee_name, COALESCE(pole.longitude, dr.latitude) AS pole_latitude, COALESCE(pole.latitude, dr.longitude) AS pole_longitude, COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) AS pole_zone_no, COALESCE(pole.pon_no, dr.pon_no, pb.pon_no) AS pole_pon_no
    FROM snags s
    LEFT JOIN users u ON u.id = s.assigned_to
    LEFT JOIN snag_reports sr ON sr.id = s.report_id
    LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
    LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
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
 * Filter snags by project + optional zone_no[] and/or pon_no[] arrays + optional
 * status[] array. zone_no / pon_no are matched against the pole/drop joined
 * values via COALESCE(pole.zone_no, dr.zone_no).
 */
export async function querySnagsByProjectAndZone(
  res: NextApiResponse,
  projectId: string,
  zoneArr: number[],
  ponArr: number[],
  statusArr: string[],
  pageNum: number,
  pageSizeNum: number,
  offset: number
) {
  const hasZone   = zoneArr.length   > 0;
  const hasPon    = ponArr.length    > 0;
  const hasStatus = statusArr.length > 0;

  if (hasZone && hasPon && hasStatus) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name,
        sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, (tu.first_name || ' ' || tu.last_name) AS noc_ticket_assignee_name,
        COALESCE(pole.longitude, dr.latitude) AS pole_latitude,
        COALESCE(pole.latitude,  dr.longitude) AS pole_longitude,
        COALESCE(pole.zone_no,   dr.zone_no, zb.zone_no)  AS pole_zone_no,
        COALESCE(pole.pon_no,    dr.pon_no, pb.pon_no)   AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN users tu ON tu.id = mt.assigned_to
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.project_id = ${projectId}
        AND COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) = ANY(${zoneArr}::int[])
        AND COALESCE(pole.pon_no,  dr.pon_no, pb.pon_no)  = ANY(${ponArr}::int[])
        AND s.status = ANY(${statusArr}::text[])
      ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC
      LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total
      FROM snags s
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.project_id = ${projectId}
        AND COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) = ANY(${zoneArr}::int[])
        AND COALESCE(pole.pon_no,  dr.pon_no, pb.pon_no)  = ANY(${ponArr}::int[])
        AND s.status = ANY(${statusArr}::text[])
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (hasZone && hasPon) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name,
        sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, (tu.first_name || ' ' || tu.last_name) AS noc_ticket_assignee_name,
        COALESCE(pole.longitude, dr.latitude) AS pole_latitude,
        COALESCE(pole.latitude,  dr.longitude) AS pole_longitude,
        COALESCE(pole.zone_no,   dr.zone_no, zb.zone_no)  AS pole_zone_no,
        COALESCE(pole.pon_no,    dr.pon_no, pb.pon_no)   AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN users tu ON tu.id = mt.assigned_to
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.project_id = ${projectId}
        AND COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) = ANY(${zoneArr}::int[])
        AND COALESCE(pole.pon_no,  dr.pon_no, pb.pon_no)  = ANY(${ponArr}::int[])
      ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC
      LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total
      FROM snags s
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.project_id = ${projectId}
        AND COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) = ANY(${zoneArr}::int[])
        AND COALESCE(pole.pon_no,  dr.pon_no, pb.pon_no)  = ANY(${ponArr}::int[])
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (hasZone && hasStatus) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name,
        sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, (tu.first_name || ' ' || tu.last_name) AS noc_ticket_assignee_name,
        COALESCE(pole.longitude, dr.latitude) AS pole_latitude,
        COALESCE(pole.latitude,  dr.longitude) AS pole_longitude,
        COALESCE(pole.zone_no,   dr.zone_no, zb.zone_no)  AS pole_zone_no,
        COALESCE(pole.pon_no,    dr.pon_no, pb.pon_no)   AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN users tu ON tu.id = mt.assigned_to
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.project_id = ${projectId}
        AND COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) = ANY(${zoneArr}::int[])
        AND s.status = ANY(${statusArr}::text[])
      ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC
      LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total
      FROM snags s
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.project_id = ${projectId}
        AND COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) = ANY(${zoneArr}::int[])
        AND s.status = ANY(${statusArr}::text[])
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (hasPon && hasStatus) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name,
        sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, (tu.first_name || ' ' || tu.last_name) AS noc_ticket_assignee_name,
        COALESCE(pole.longitude, dr.latitude) AS pole_latitude,
        COALESCE(pole.latitude,  dr.longitude) AS pole_longitude,
        COALESCE(pole.zone_no,   dr.zone_no, zb.zone_no)  AS pole_zone_no,
        COALESCE(pole.pon_no,    dr.pon_no, pb.pon_no)   AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN users tu ON tu.id = mt.assigned_to
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.project_id = ${projectId}
        AND COALESCE(pole.pon_no, dr.pon_no, pb.pon_no) = ANY(${ponArr}::int[])
        AND s.status = ANY(${statusArr}::text[])
      ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC
      LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total
      FROM snags s
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.project_id = ${projectId}
        AND COALESCE(pole.pon_no, dr.pon_no, pb.pon_no) = ANY(${ponArr}::int[])
        AND s.status = ANY(${statusArr}::text[])
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  if (hasZone) {
    const rows = await sql`
      SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name,
        sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, (tu.first_name || ' ' || tu.last_name) AS noc_ticket_assignee_name,
        COALESCE(pole.longitude, dr.latitude) AS pole_latitude,
        COALESCE(pole.latitude,  dr.longitude) AS pole_longitude,
        COALESCE(pole.zone_no,   dr.zone_no, zb.zone_no)  AS pole_zone_no,
        COALESCE(pole.pon_no,    dr.pon_no, pb.pon_no)   AS pole_pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN users tu ON tu.id = mt.assigned_to
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.project_id = ${projectId}
        AND COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) = ANY(${zoneArr}::int[])
      ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC
      LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Snag[];
    const countRows = await sql`
      SELECT COUNT(*) AS total
      FROM snags s
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
      WHERE s.project_id = ${projectId}
        AND COALESCE(pole.zone_no, dr.zone_no, zb.zone_no) = ANY(${zoneArr}::int[])
    ` as Array<{ total: string }>;
    return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
  }

  // hasPon only (fallback)
  const rows = await sql`
    SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name,
      sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid, (tu.first_name || ' ' || tu.last_name) AS noc_ticket_assignee_name,
      COALESCE(pole.longitude, dr.latitude) AS pole_latitude,
      COALESCE(pole.latitude,  dr.longitude) AS pole_longitude,
      COALESCE(pole.zone_no,   dr.zone_no, zb.zone_no)  AS pole_zone_no,
      COALESCE(pole.pon_no,    dr.pon_no, pb.pon_no)   AS pole_pon_no
    FROM snags s
    LEFT JOIN users u ON u.id = s.assigned_to
    LEFT JOIN snag_reports sr ON sr.id = s.report_id
    LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
    LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
    LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
    WHERE s.project_id = ${projectId}
      AND COALESCE(pole.pon_no, dr.pon_no, pb.pon_no) = ANY(${ponArr}::int[])
    ORDER BY sr.audit_date DESC, s.grid_index ASC, s.snag_number ASC
    LIMIT ${pageSizeNum} OFFSET ${offset}
  ` as Snag[];
  const countRows = await sql`
    SELECT COUNT(*) AS total
    FROM snags s
    LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
    LEFT JOIN drops dr ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb ON pb.id = s.pon_id
    WHERE s.project_id = ${projectId}
      AND COALESCE(pole.pon_no, dr.pon_no, pb.pon_no) = ANY(${ponArr}::int[])
  ` as Array<{ total: string }>;
  return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total: parseInt(countRows[0]?.total ?? '0', 10) });
}

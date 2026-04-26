/**
 * geo-mismatch report (PRD-061 FR-REPORT-GM-*).
 *
 * One row per unresolved geofence_mismatch / vehicle_gps_mismatch
 * exception. Joins exception → entry → staff → nearest known site
 * (the entry's recorded site_geofence_id) to give the supervisor enough
 * to investigate. Distance is the geofence radius captured on the site
 * row at clock-in; we don't recompute (the cron that flagged it already
 * did the math).
 */

import { sql } from '@/lib/db-pool';
import { makeParamBuilder } from './sqlHelpers';
import { ReportTooLargeError, REPORT_ROW_CAP } from './runner';
import type { ReportColumn, ReportInput, ReportRunResult } from './types';

const COLUMNS: ReadonlyArray<ReportColumn> = [
  { key: 'work_date', label: 'Date' },
  { key: 'staff', label: 'Staff' },
  { key: 'department', label: 'Dept' },
  { key: 'clock_in_lat', label: 'Lat' },
  { key: 'clock_in_lon', label: 'Lon' },
  { key: 'site_name', label: 'Recorded site' },
  { key: 'site_radius_km', label: 'Geofence (km)', align: 'right', format: 'number' },
  { key: 'exception_kind', label: 'Kind' },
  { key: 'has_correction', label: 'Has correction?' },
  { key: 'exception_id', label: 'Exception ID' },
];

interface Row extends Record<string, unknown> {
  exception_id: string;
  work_date: string;
  staff_id: string;
  full_name: string;
  department: string | null;
  clock_in_lat: string | null;
  clock_in_lon: string | null;
  site_name: string | null;
  site_radius_km: string | null;
  exception_kind: string;
  has_correction: boolean;
}

const RELEVANT_KINDS = ['geofence_mismatch', 'vehicle_gps_mismatch'] as const;

export async function runGeoMismatch(input: ReportInput): Promise<ReportRunResult> {
  if (!input.dateFrom || !input.dateTo) {
    return { rows: [], columns: COLUMNS, notes: ['Date range is required.'] };
  }
  const pb = makeParamBuilder();
  const parts: string[] = [
    `xe.work_date >= ${pb.next(input.dateFrom)}::date`,
    `xe.work_date <= ${pb.next(input.dateTo)}::date`,
    `x.resolved_at IS NULL`,
    `x.exception_kind = ANY(${pb.next([...RELEVANT_KINDS])}::text[])`,
  ];
  if (input.scopedStaffIds !== null) {
    parts.push(`xe.staff_id = ANY(${pb.next(input.scopedStaffIds)}::uuid[])`);
  }
  if (input.departments.length > 0) {
    parts.push(`s.department = ANY(${pb.next(input.departments)}::text[])`);
  }
  if (input.siteIds.length > 0) {
    parts.push(`xe.site_geofence_id = ANY(${pb.next(input.siteIds)}::uuid[])`);
  }
  const where = parts.join(' AND ');

  const text = `
    SELECT
      x.id::text                                   AS exception_id,
      xe.work_date::text                           AS work_date,
      xe.staff_id::text                            AS staff_id,
      TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS full_name,
      s.department,
      xe.clock_in_lat::text                        AS clock_in_lat,
      xe.clock_in_lon::text                        AS clock_in_lon,
      site.name                                    AS site_name,
      site.radius_km::text                         AS site_radius_km,
      x.exception_kind                             AS exception_kind,
      EXISTS (
        SELECT 1 FROM attendance_adjustments adj
         WHERE adj.entry_id = xe.id AND adj.status IN ('pending','approved')
      )                                            AS has_correction
    FROM attendance_exceptions x
    JOIN attendance_entries xe ON xe.id = x.entry_id
    JOIN staff s ON s.id = xe.staff_id
    LEFT JOIN fleet_authorized_locations site ON site.id = xe.site_geofence_id
    WHERE ${where}
    ORDER BY xe.work_date DESC, full_name ASC
    LIMIT ${pb.next(REPORT_ROW_CAP + 1)}
  `;
  const rows = await sql.query<Row>(text, pb.params);
  // Detect overflow before allocating result objects — keeps memory bounded
  // even when an admin runs an unscoped year-wide query.
  if (rows.length > REPORT_ROW_CAP) {
    throw new ReportTooLargeError(rows.length);
  }
  return {
    rows: rows.map((r) => ({
      work_date: r.work_date,
      staff: r.full_name,
      department: r.department ?? '',
      clock_in_lat: r.clock_in_lat ?? '',
      clock_in_lon: r.clock_in_lon ?? '',
      site_name: r.site_name ?? '',
      site_radius_km: r.site_radius_km !== null ? Number(r.site_radius_km) : 0,
      exception_kind: r.exception_kind,
      has_correction: r.has_correction ? 'yes' : 'no',
      exception_id: r.exception_id,
    })),
    columns: COLUMNS,
    notes: [],
  };
}

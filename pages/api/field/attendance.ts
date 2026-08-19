/**
 * GET /api/field/attendance
 *
 * Returns attendance entries for field workers (role IN technician, casual) over
 * a given date range. Supports an optional `status` filter (all | pending | active)
 * that narrows by the worker's account_status.
 *
 * IMPORTANT — Rule-P exemption:
 *   This endpoint deliberately does NOT apply the `approvedAccountPredicate`
 *   (account_status <> 'pending') used by the normal staff attendance search.
 *   Pending workers MUST be visible here so that admins managing the field-worker
 *   approval workflow can see their clock-in/out history before activating them.
 *
 * Auth: withAuth(withPermission('people.staff.attendance.search', 'view'))
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FieldAttendanceRow {
  entry_id:         string;
  staff_id:         string;
  staff_name:       string;
  role:             string;
  account_status:   string;
  work_date:        string;
  clock_in_at:      string | null;
  clock_out_at:     string | null;
  entry_status:     string;
  hours:            number | null;
  entry_updated_at: string;
  site_geofence_id: string | null;
  /** Nearest project AOI at each clock event, recorded at write time. NULL
   *  for entries not written by the portal clock path (manual admin entries,
   *  and the auto-close cron, which has no clock-out fix to attribute). */
  clock_in_aoi_project:    string | null;
  clock_in_aoi_distance_m: number | null;
  clock_out_aoi_project:    string | null;
  clock_out_aoi_distance_m: number | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type StatusFilter = 'all' | 'pending' | 'active';

function isStatusFilter(v: string): v is StatusFilter {
  return v === 'all' || v === 'pending' || v === 'active';
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
    return;
  }

  const from   = String(req.query.from ?? '');
  const to     = String(req.query.to ?? '');
  const rawStatus = String(req.query.status ?? 'all');

  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    apiResponse.badRequest(res, 'from and to must be YYYY-MM-DD');
    return;
  }

  const status: StatusFilter = isStatusFilter(rawStatus) ? rawStatus : 'all';

  try {
    // NOTE: Explicit query branches are required here. The Neon-shim tagged
    // template (`@/lib/db-pool`'s `sql`) does NOT support conditional
    // sub-template interpolation (${cond ? sql`…` : sql``}) — per CLAUDE.md.
    // Three separate, complete query strings are used instead; only the WHERE
    // clause differs. This mirrors the pattern established in
    // pages/api/field/users/index.ts.
    //
    // Rule-P exemption is preserved in ALL branches:
    //   - no `account_status <> 'pending'`
    //   - no `approvedAccountPredicate`
    //   - `role IN ('technician','casual')` is the only staff filter beyond dates.

    // WORKING: SqlRow = Record<string,unknown>; we cast after the query
    //   rather than using the generic parameter (which requires the target type
    //   to satisfy the index-signature constraint strictly).
    let rows: FieldAttendanceRow[];

    if (status === 'pending') {
      rows = (await sql`
        SELECT
          e.id                                                           AS entry_id,
          s.id                                                           AS staff_id,
          TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, ''))
                                                                         AS staff_name,
          s.role,
          s.account_status,
          to_char(e.work_date, 'YYYY-MM-DD')                             AS work_date,
          e.clock_in_at,
          e.clock_out_at,
          e.status                                                        AS entry_status,
          e.site_geofence_id,
          e.updated_at::text                                             AS entry_updated_at,
          pin.project_name                                               AS clock_in_aoi_project,
          e.clock_in_aoi_distance_m::float                               AS clock_in_aoi_distance_m,
          pout.project_name                                              AS clock_out_aoi_project,
          e.clock_out_aoi_distance_m::float                              AS clock_out_aoi_distance_m,
          CASE
            WHEN e.clock_out_at IS NULL THEN NULL
            ELSE ROUND(
              EXTRACT(EPOCH FROM (e.clock_out_at - e.clock_in_at)) / 3600.0,
              2
            )::float
          END                                                             AS hours
        FROM attendance_entries e
        JOIN staff s ON s.id = e.staff_id
        LEFT JOIN projects pin  ON pin.id  = e.clock_in_aoi_project_id
        LEFT JOIN projects pout ON pout.id = e.clock_out_aoi_project_id
        WHERE s.role IN ('technician', 'casual')
          AND LOWER(s.account_status) = 'pending'
          AND e.work_date BETWEEN ${from} AND ${to}
        ORDER BY s.first_name, s.last_name, e.work_date DESC
        LIMIT 1000
      `) as unknown as FieldAttendanceRow[];
    } else if (status === 'active') {
      rows = (await sql`
        SELECT
          e.id                                                           AS entry_id,
          s.id                                                           AS staff_id,
          TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, ''))
                                                                         AS staff_name,
          s.role,
          s.account_status,
          to_char(e.work_date, 'YYYY-MM-DD')                             AS work_date,
          e.clock_in_at,
          e.clock_out_at,
          e.status                                                        AS entry_status,
          e.site_geofence_id,
          e.updated_at::text                                             AS entry_updated_at,
          pin.project_name                                               AS clock_in_aoi_project,
          e.clock_in_aoi_distance_m::float                               AS clock_in_aoi_distance_m,
          pout.project_name                                              AS clock_out_aoi_project,
          e.clock_out_aoi_distance_m::float                              AS clock_out_aoi_distance_m,
          CASE
            WHEN e.clock_out_at IS NULL THEN NULL
            ELSE ROUND(
              EXTRACT(EPOCH FROM (e.clock_out_at - e.clock_in_at)) / 3600.0,
              2
            )::float
          END                                                             AS hours
        FROM attendance_entries e
        JOIN staff s ON s.id = e.staff_id
        LEFT JOIN projects pin  ON pin.id  = e.clock_in_aoi_project_id
        LEFT JOIN projects pout ON pout.id = e.clock_out_aoi_project_id
        WHERE s.role IN ('technician', 'casual')
          AND LOWER(s.account_status) = 'active'
          AND e.work_date BETWEEN ${from} AND ${to}
        ORDER BY s.first_name, s.last_name, e.work_date DESC
        LIMIT 1000
      `) as unknown as FieldAttendanceRow[];
    } else {
      // status === 'all' — no account_status filter; Rule-P exemption fully open
      rows = (await sql`
        SELECT
          e.id                                                           AS entry_id,
          s.id                                                           AS staff_id,
          TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, ''))
                                                                         AS staff_name,
          s.role,
          s.account_status,
          to_char(e.work_date, 'YYYY-MM-DD')                             AS work_date,
          e.clock_in_at,
          e.clock_out_at,
          e.status                                                        AS entry_status,
          e.site_geofence_id,
          e.updated_at::text                                             AS entry_updated_at,
          pin.project_name                                               AS clock_in_aoi_project,
          e.clock_in_aoi_distance_m::float                               AS clock_in_aoi_distance_m,
          pout.project_name                                              AS clock_out_aoi_project,
          e.clock_out_aoi_distance_m::float                              AS clock_out_aoi_distance_m,
          CASE
            WHEN e.clock_out_at IS NULL THEN NULL
            ELSE ROUND(
              EXTRACT(EPOCH FROM (e.clock_out_at - e.clock_in_at)) / 3600.0,
              2
            )::float
          END                                                             AS hours
        FROM attendance_entries e
        JOIN staff s ON s.id = e.staff_id
        LEFT JOIN projects pin  ON pin.id  = e.clock_in_aoi_project_id
        LEFT JOIN projects pout ON pout.id = e.clock_out_aoi_project_id
        WHERE s.role IN ('technician', 'casual')
          AND e.work_date BETWEEN ${from} AND ${to}
        ORDER BY s.first_name, s.last_name, e.work_date DESC
        LIMIT 1000
      `) as unknown as FieldAttendanceRow[];
    }

    apiResponse.success(res, { rows });
  } catch (err) {
    log.error(
      '[field-attendance] query failed',
      { error: err instanceof Error ? err.message : String(err) },
      'FieldAttendanceAPI'
    );
    apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('people.staff.attendance.search', 'view')(handler));

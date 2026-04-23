/**
 * GET /api/staff/attendance-overview
 *
 * Exec dashboard aggregator. Returns every counter the /staff/attendance/overview
 * page renders, in one round-trip. Read-only — no writes, no locks.
 *
 * Query params (all optional):
 *   ?weeks=N     — number of weeks of history to aggregate (default 4, cap 12)
 *
 * Response:
 *   {
 *     weeks: [
 *       {
 *         weekStart: 'YYYY-MM-DD',
 *         regularHrs, overtimeHrs, sundayHrs, holidayHrs, nightHrs,
 *         wageAmount, exceptionsCount, mismatchCount
 *       },
 *       ...
 *     ],
 *     pendingCorrections, openExceptions,
 *     topOvertimeStaff: [ { staffId, fullName, overtimeHrs }, ... ],
 *     cartrackCoverage: { match, mismatch, no_data, vehicle_not_mapped,
 *                         device_gps_off, total, matchPct },
 *     generatedAt
 *   }
 *
 * Scope: super_admin / admin see the whole org; others see only staff
 * they supervise (same helper as the corrections queue — #1405).
 *
 * RBAC: people.staff.attendance.manage, view. Scope narrows within that.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';
import {
  withAuth,
  withPermission,
  type AuthenticatedNextApiRequest,
} from '@/lib/auth/middleware';
import { staffIdsSupervisedBy } from '@/services/attendance/supervisorScope';
import { getStaffIdForUser } from '@/services/staff/staffAccessService';

const DEFAULT_WEEKS = 4;
const MAX_WEEKS = 12;

function isoWeekMonday(d: Date): Date {
  const out = new Date(d);
  // JS getUTCDay(): 0=Sun, 1=Mon, ..., 6=Sat. Shift Sunday (0) to 7 so
  // Monday subtraction works cleanly.
  const day = out.getUTCDay() || 7;
  out.setUTCDate(out.getUTCDate() - (day - 1));
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function resolveScope(
  req: NextApiRequest
): Promise<string[] | null> {
  const user = (req as AuthenticatedNextApiRequest).user;
  if (user.role === 'super_admin' || user.role === 'admin') return null;
  const viewerStaffId = await getStaffIdForUser(user.id);
  return viewerStaffId ? await staffIdsSupervisedBy(viewerStaffId) : [];
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const weeksRaw = typeof req.query.weeks === 'string' ? Number(req.query.weeks) : NaN;
  const weeks = Math.min(
    Math.max(Number.isFinite(weeksRaw) && weeksRaw > 0 ? Math.trunc(weeksRaw) : DEFAULT_WEEKS, 1),
    MAX_WEEKS
  );

  // Compute window: [earliestMonday, todaySAST]. We anchor to SAST
  // mondays so the buckets line up with the weekly export surface.
  const todaySast = new Date(
    new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })
  );
  const latestMonday = isoWeekMonday(todaySast);
  const earliestMonday = new Date(latestMonday);
  earliestMonday.setUTCDate(earliestMonday.getUTCDate() - 7 * (weeks - 1));
  const fromDate = ymd(earliestMonday);
  const toDate = ymd(todaySast);

  try {
    const scopedToStaffIds = await resolveScope(req);
    // Empty-scope short-circuit matches listAdjustmentsForReview.
    if (scopedToStaffIds !== null && scopedToStaffIds.length === 0) {
      return apiResponse.success(res, {
        weeks: [],
        pendingCorrections: 0,
        openExceptions: 0,
        topOvertimeStaff: [],
        cartrackCoverage: {
          match: 0,
          mismatch: 0,
          no_data: 0,
          vehicle_not_mapped: 0,
          device_gps_off: 0,
          total: 0,
          matchPct: null,
        },
        generatedAt: new Date().toISOString(),
      });
    }

    // Four SQL queries, Promise.all. Each is scope-aware (null scope
    // bypasses the WHERE on staff_id).
    const [weekly, pending, openEx, topOt, cartrack] = await Promise.all([
      loadWeeklyTotals(fromDate, toDate, scopedToStaffIds),
      loadPendingCorrections(scopedToStaffIds),
      loadOpenExceptions(fromDate, toDate, scopedToStaffIds),
      loadTopOvertimeThisWeek(ymd(latestMonday), scopedToStaffIds),
      loadCartrackCoverage(fromDate, toDate, scopedToStaffIds),
    ]);

    apiResponse.success(res, {
      weeks: weekly,
      pendingCorrections: pending,
      openExceptions: openEx,
      topOvertimeStaff: topOt,
      cartrackCoverage: cartrack,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    log.error('[staff-attendance-overview] failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    apiResponse.internalError(res, err);
  }
}

interface WeeklyRow extends Record<string, unknown> {
  week_start: string;
  regular_hrs: string;
  overtime_hrs: string;
  sunday_hrs: string;
  holiday_hrs: string;
  night_hrs: string;
  wage_amount_cents: string | null;
  exceptions_count: string;
  mismatch_count: string;
}

async function loadWeeklyTotals(
  fromDate: string,
  toDate: string,
  scope: string[] | null
): Promise<
  Array<{
    weekStart: string;
    regularHrs: number;
    overtimeHrs: number;
    sundayHrs: number;
    holidayHrs: number;
    nightHrs: number;
    wageAmount: number | null;
    exceptionsCount: number;
    mismatchCount: number;
  }>
> {
  const rows =
    scope === null
      ? await sql<WeeklyRow>`
          WITH summaries AS (
            SELECT
              (DATE_TRUNC('week', work_date::timestamp)::date) AS week_start,
              regular_hrs, overtime_hrs, sunday_hrs, holiday_hrs, night_hrs,
              wage_amount_cents, staff_id, work_date
            FROM attendance_daily_summaries
            WHERE work_date >= ${fromDate}::date
              AND work_date <= ${toDate}::date
          ),
          week_exceptions AS (
            SELECT DATE_TRUNC('week', xe.work_date::timestamp)::date AS week_start,
                   COUNT(*)::text AS exceptions_count
            FROM attendance_exceptions x
            JOIN attendance_entries xe ON xe.id = x.entry_id
            WHERE xe.work_date >= ${fromDate}::date
              AND xe.work_date <= ${toDate}::date
              AND x.resolved_at IS NULL
            GROUP BY 1
          ),
          week_mismatches AS (
            SELECT DATE_TRUNC('week', ve.work_date::timestamp)::date AS week_start,
                   COUNT(*)::text AS mismatch_count
            FROM attendance_gps_verifications v
            JOIN attendance_entries ve ON ve.id = v.entry_id
            WHERE ve.work_date >= ${fromDate}::date
              AND ve.work_date <= ${toDate}::date
              AND v.verdict = 'mismatch'
            GROUP BY 1
          )
          SELECT
            s.week_start::text AS week_start,
            COALESCE(SUM(s.regular_hrs), 0)::text  AS regular_hrs,
            COALESCE(SUM(s.overtime_hrs), 0)::text AS overtime_hrs,
            COALESCE(SUM(s.sunday_hrs), 0)::text   AS sunday_hrs,
            COALESCE(SUM(s.holiday_hrs), 0)::text  AS holiday_hrs,
            COALESCE(SUM(s.night_hrs), 0)::text    AS night_hrs,
            COALESCE(SUM(s.wage_amount_cents), 0)::text AS wage_amount_cents,
            COALESCE(wx.exceptions_count, '0') AS exceptions_count,
            COALESCE(wm.mismatch_count, '0') AS mismatch_count
          FROM summaries s
          LEFT JOIN week_exceptions wx ON wx.week_start = s.week_start
          LEFT JOIN week_mismatches wm ON wm.week_start = s.week_start
          GROUP BY s.week_start, wx.exceptions_count, wm.mismatch_count
          ORDER BY s.week_start DESC
        `
      : await sql<WeeklyRow>`
          WITH summaries AS (
            SELECT
              (DATE_TRUNC('week', work_date::timestamp)::date) AS week_start,
              regular_hrs, overtime_hrs, sunday_hrs, holiday_hrs, night_hrs,
              wage_amount_cents, staff_id, work_date
            FROM attendance_daily_summaries
            WHERE work_date >= ${fromDate}::date
              AND work_date <= ${toDate}::date
              AND staff_id = ANY(${scope}::uuid[])
          ),
          week_exceptions AS (
            SELECT DATE_TRUNC('week', xe.work_date::timestamp)::date AS week_start,
                   COUNT(*)::text AS exceptions_count
            FROM attendance_exceptions x
            JOIN attendance_entries xe ON xe.id = x.entry_id
            WHERE xe.work_date >= ${fromDate}::date
              AND xe.work_date <= ${toDate}::date
              AND x.resolved_at IS NULL
              AND xe.staff_id = ANY(${scope}::uuid[])
            GROUP BY 1
          ),
          week_mismatches AS (
            SELECT DATE_TRUNC('week', ve.work_date::timestamp)::date AS week_start,
                   COUNT(*)::text AS mismatch_count
            FROM attendance_gps_verifications v
            JOIN attendance_entries ve ON ve.id = v.entry_id
            WHERE ve.work_date >= ${fromDate}::date
              AND ve.work_date <= ${toDate}::date
              AND v.verdict = 'mismatch'
              AND ve.staff_id = ANY(${scope}::uuid[])
            GROUP BY 1
          )
          SELECT
            s.week_start::text AS week_start,
            COALESCE(SUM(s.regular_hrs), 0)::text  AS regular_hrs,
            COALESCE(SUM(s.overtime_hrs), 0)::text AS overtime_hrs,
            COALESCE(SUM(s.sunday_hrs), 0)::text   AS sunday_hrs,
            COALESCE(SUM(s.holiday_hrs), 0)::text  AS holiday_hrs,
            COALESCE(SUM(s.night_hrs), 0)::text    AS night_hrs,
            COALESCE(SUM(s.wage_amount_cents), 0)::text AS wage_amount_cents,
            COALESCE(wx.exceptions_count, '0') AS exceptions_count,
            COALESCE(wm.mismatch_count, '0') AS mismatch_count
          FROM summaries s
          LEFT JOIN week_exceptions wx ON wx.week_start = s.week_start
          LEFT JOIN week_mismatches wm ON wm.week_start = s.week_start
          GROUP BY s.week_start, wx.exceptions_count, wm.mismatch_count
          ORDER BY s.week_start DESC
        `;
  return rows.map((r) => ({
    weekStart: r.week_start,
    regularHrs: Number(r.regular_hrs) || 0,
    overtimeHrs: Number(r.overtime_hrs) || 0,
    sundayHrs: Number(r.sunday_hrs) || 0,
    holidayHrs: Number(r.holiday_hrs) || 0,
    nightHrs: Number(r.night_hrs) || 0,
    wageAmount: r.wage_amount_cents == null ? null : Number(r.wage_amount_cents) / 100,
    exceptionsCount: Number(r.exceptions_count) || 0,
    mismatchCount: Number(r.mismatch_count) || 0,
  }));
}

async function loadPendingCorrections(
  scope: string[] | null
): Promise<number> {
  const rows =
    scope === null
      ? await sql<{ count: string }>`
          SELECT COUNT(*)::text AS count
          FROM attendance_adjustments
          WHERE status = 'pending'
        `
      : await sql<{ count: string }>`
          SELECT COUNT(*)::text AS count
          FROM attendance_adjustments a
          JOIN attendance_entries e ON e.id = a.entry_id
          WHERE a.status = 'pending'
            AND e.staff_id = ANY(${scope}::uuid[])
        `;
  return Number(rows[0]?.count ?? 0);
}

async function loadOpenExceptions(
  fromDate: string,
  toDate: string,
  scope: string[] | null
): Promise<number> {
  const rows =
    scope === null
      ? await sql<{ count: string }>`
          SELECT COUNT(*)::text AS count
          FROM attendance_exceptions x
          JOIN attendance_entries e ON e.id = x.entry_id
          WHERE x.resolved_at IS NULL
            AND e.work_date >= ${fromDate}::date
            AND e.work_date <= ${toDate}::date
        `
      : await sql<{ count: string }>`
          SELECT COUNT(*)::text AS count
          FROM attendance_exceptions x
          JOIN attendance_entries e ON e.id = x.entry_id
          WHERE x.resolved_at IS NULL
            AND e.work_date >= ${fromDate}::date
            AND e.work_date <= ${toDate}::date
            AND e.staff_id = ANY(${scope}::uuid[])
        `;
  return Number(rows[0]?.count ?? 0);
}

interface TopOtRow extends Record<string, unknown> {
  staff_id: string;
  full_name: string;
  overtime_hrs: string;
}

async function loadTopOvertimeThisWeek(
  weekMonday: string,
  scope: string[] | null
): Promise<
  Array<{ staffId: string; fullName: string; overtimeHrs: number }>
> {
  const rows =
    scope === null
      ? await sql<TopOtRow>`
          SELECT ds.staff_id,
                 TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS full_name,
                 SUM(ds.overtime_hrs)::text AS overtime_hrs
          FROM attendance_daily_summaries ds
          JOIN staff s ON s.id = ds.staff_id
          WHERE ds.work_date >= ${weekMonday}::date
          GROUP BY ds.staff_id, s.first_name, s.last_name
          HAVING SUM(ds.overtime_hrs) > 0
          ORDER BY SUM(ds.overtime_hrs) DESC
          LIMIT 5
        `
      : await sql<TopOtRow>`
          SELECT ds.staff_id,
                 TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS full_name,
                 SUM(ds.overtime_hrs)::text AS overtime_hrs
          FROM attendance_daily_summaries ds
          JOIN staff s ON s.id = ds.staff_id
          WHERE ds.work_date >= ${weekMonday}::date
            AND ds.staff_id = ANY(${scope}::uuid[])
          GROUP BY ds.staff_id, s.first_name, s.last_name
          HAVING SUM(ds.overtime_hrs) > 0
          ORDER BY SUM(ds.overtime_hrs) DESC
          LIMIT 5
        `;
  return rows.map((r) => ({
    staffId: r.staff_id,
    fullName: r.full_name,
    overtimeHrs: Number(r.overtime_hrs) || 0,
  }));
}

interface CartrackRow extends Record<string, unknown> {
  verdict: string;
  count: string;
}

async function loadCartrackCoverage(
  fromDate: string,
  toDate: string,
  scope: string[] | null
): Promise<{
  match: number;
  mismatch: number;
  no_data: number;
  vehicle_not_mapped: number;
  device_gps_off: number;
  total: number;
  matchPct: number | null;
}> {
  const rows =
    scope === null
      ? await sql<CartrackRow>`
          SELECT v.verdict, COUNT(*)::text AS count
          FROM attendance_gps_verifications v
          JOIN attendance_entries e ON e.id = v.entry_id
          WHERE e.work_date >= ${fromDate}::date
            AND e.work_date <= ${toDate}::date
          GROUP BY v.verdict
        `
      : await sql<CartrackRow>`
          SELECT v.verdict, COUNT(*)::text AS count
          FROM attendance_gps_verifications v
          JOIN attendance_entries e ON e.id = v.entry_id
          WHERE e.work_date >= ${fromDate}::date
            AND e.work_date <= ${toDate}::date
            AND e.staff_id = ANY(${scope}::uuid[])
          GROUP BY v.verdict
        `;
  const out = {
    match: 0,
    mismatch: 0,
    no_data: 0,
    vehicle_not_mapped: 0,
    device_gps_off: 0,
  };
  for (const r of rows) {
    if (r.verdict in out) {
      out[r.verdict as keyof typeof out] = Number(r.count) || 0;
    }
  }
  const total =
    out.match +
    out.mismatch +
    out.no_data +
    out.vehicle_not_mapped +
    out.device_gps_off;
  const matchPct =
    total > 0 ? Math.round((out.match / total) * 1000) / 10 : null;
  return { ...out, total, matchPct };
}

export default withAuth(
  withPermission('people.staff.attendance.manage', 'view')(handler)
);

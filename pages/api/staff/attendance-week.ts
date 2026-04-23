/**
 * GET /api/staff/attendance-week?week_start=YYYY-MM-DD
 *
 * Aggregated week view for back-office supervisors. Returns one entry per
 * staff member with per-day buckets (regular/OT/Sun/holiday/night/exceptions)
 * and a weekly roll-up. `week_start` must be a Monday (ISO payroll week).
 *
 * RBAC: `people.staff.attendance.manage` view.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { lookupActiveLock } from '@/modules/attendance/corrections/lockQueries';

interface WeekRow extends Record<string, unknown> {
  staff_id: string;
  employee_id: string | null;
  full_name: string;
  work_date: string;
  regular_hrs: string;
  overtime_hrs: string;
  sunday_hrs: string;
  holiday_hrs: string;
  night_hrs: string;
  exceptions_count: number;
}

interface DayTotals {
  workDate: string;
  regularHrs: number;
  overtimeHrs: number;
  sundayHrs: number;
  holidayHrs: number;
  nightHrs: number;
  exceptionsCount: number;
}

interface StaffWeekRow {
  staffId: string;
  fullName: string;
  employeeId: string | null;
  days: DayTotals[];
  weekTotals: {
    regularHrs: number;
    overtimeHrs: number;
    sundayHrs: number;
    holidayHrs: number;
    nightHrs: number;
    exceptionsCount: number;
  };
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidYmd(s: string): boolean {
  if (!YMD_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && s === d.toISOString().slice(0, 10);
}

function isMonday(ymd: string): boolean {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay() === 1;
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const weekStart = typeof req.query.week_start === 'string' ? req.query.week_start : '';
  if (!isValidYmd(weekStart)) {
    return apiResponse.badRequest(res, 'week_start must be YYYY-MM-DD');
  }
  if (!isMonday(weekStart)) {
    return apiResponse.badRequest(
      res,
      'week_start must fall on a Monday (ISO-week payroll convention)'
    );
  }
  const weekEnd = addDays(weekStart, 6);

  try {
    // Replaced the per-row correlated subquery with a single scan of
    // unresolved exceptions for the week, pre-aggregated. At scale (50
    // staff × 7 days = 350 summary rows) this is one scan vs. 350.
    const rows = await sql<WeekRow>`
      WITH week_exceptions AS (
        SELECT xe.staff_id, xe.work_date, COUNT(*)::int AS exceptions_count
        FROM attendance_exceptions x
        JOIN attendance_entries xe ON xe.id = x.entry_id
        WHERE xe.work_date >= ${weekStart}::date
          AND xe.work_date <= ${weekEnd}::date
          AND x.resolved_at IS NULL
        GROUP BY xe.staff_id, xe.work_date
      )
      SELECT
        ds.staff_id,
        s.employee_id,
        TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS full_name,
        ds.work_date::text AS work_date,
        ds.regular_hrs::text,
        ds.overtime_hrs::text,
        ds.sunday_hrs::text,
        ds.holiday_hrs::text,
        ds.night_hrs::text,
        COALESCE(wx.exceptions_count, 0) AS exceptions_count
      FROM attendance_daily_summaries ds
      JOIN staff s ON s.id = ds.staff_id
      LEFT JOIN week_exceptions wx
        ON wx.staff_id = ds.staff_id AND wx.work_date = ds.work_date
      WHERE ds.work_date >= ${weekStart}::date
        AND ds.work_date <= ${weekEnd}::date
      ORDER BY full_name ASC, ds.work_date ASC
    `;

    // Defence-in-depth: the DB PK `(staff_id, work_date)` enforces row
    // uniqueness today, but a future join that adds a duplicating relation
    // would silently double-count week totals. Fail loud instead.
    const seen = new Set<string>();
    const byStaff = new Map<string, StaffWeekRow>();
    for (const r of rows) {
      const dedupeKey = `${r.staff_id}|${r.work_date}`;
      if (seen.has(dedupeKey)) {
        log.error(
          '[staff-attendance-week] duplicate (staff_id, work_date) row — invariant broken',
          { staffId: r.staff_id, workDate: r.work_date }
        );
        return apiResponse.internalError(
          res,
          new Error('duplicate summary rows for (staff_id, work_date)')
        );
      }
      seen.add(dedupeKey);
      const day: DayTotals = {
        workDate: r.work_date,
        regularHrs: Number(r.regular_hrs),
        overtimeHrs: Number(r.overtime_hrs),
        sundayHrs: Number(r.sunday_hrs),
        holidayHrs: Number(r.holiday_hrs),
        nightHrs: Number(r.night_hrs),
        exceptionsCount: r.exceptions_count,
      };
      const existing = byStaff.get(r.staff_id);
      if (existing) {
        existing.days.push(day);
        existing.weekTotals.regularHrs += day.regularHrs;
        existing.weekTotals.overtimeHrs += day.overtimeHrs;
        existing.weekTotals.sundayHrs += day.sundayHrs;
        existing.weekTotals.holidayHrs += day.holidayHrs;
        existing.weekTotals.nightHrs += day.nightHrs;
        existing.weekTotals.exceptionsCount += day.exceptionsCount;
      } else {
        byStaff.set(r.staff_id, {
          staffId: r.staff_id,
          employeeId: r.employee_id,
          fullName: r.full_name,
          days: [day],
          weekTotals: {
            regularHrs: day.regularHrs,
            overtimeHrs: day.overtimeHrs,
            sundayHrs: day.sundayHrs,
            holidayHrs: day.holidayHrs,
            nightHrs: day.nightHrs,
            exceptionsCount: day.exceptionsCount,
          },
        });
      }
    }

    const staff = Array.from(byStaff.values()).sort((a, b) =>
      a.fullName.localeCompare(b.fullName)
    );

    const totals = staff.reduce(
      (acc, s) => ({
        regularHrs: acc.regularHrs + s.weekTotals.regularHrs,
        overtimeHrs: acc.overtimeHrs + s.weekTotals.overtimeHrs,
        sundayHrs: acc.sundayHrs + s.weekTotals.sundayHrs,
        holidayHrs: acc.holidayHrs + s.weekTotals.holidayHrs,
        nightHrs: acc.nightHrs + s.weekTotals.nightHrs,
        exceptionsCount: acc.exceptionsCount + s.weekTotals.exceptionsCount,
        staffCount: acc.staffCount + 1,
      }),
      {
        regularHrs: 0,
        overtimeHrs: 0,
        sundayHrs: 0,
        holidayHrs: 0,
        nightHrs: 0,
        exceptionsCount: 0,
        staffCount: 0,
      }
    );

    // Surface the lock state so the UI can paint a banner + block edits.
    const activeLock = await lookupActiveLock(weekStart);
    const lock = activeLock
      ? {
          lockedAt: activeLock.locked_at,
          lockedBy: activeLock.locked_by,
          reason: activeLock.lock_reason,
        }
      : null;
    return apiResponse.success(res, { weekStart, weekEnd, staff, totals, lock });
  } catch (err) {
    log.error('[staff-attendance-week] unexpected error', {
      weekStart,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('people.staff.attendance.manage', 'view')(handler));

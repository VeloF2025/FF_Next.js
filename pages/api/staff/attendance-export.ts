/**
 * GET /api/staff/attendance-export?week_start=YYYY-MM-DD&format=csv|xlsx
 *
 * Weekly payroll export. Format-agnostic columns per Phase 1b PRD:
 *   staff_id | employee_id | full_name | work_date |
 *   clock_in_at | clock_out_at |
 *   regular_hrs | overtime_hrs | sunday_hrs | holiday_hrs | night_hrs |
 *   wage_amount | exceptions_count
 *
 * Rows:
 *   - Seven calendar days from week_start (ISO-week Monday enforced — we
 *     reject a non-Monday to keep payroll weeks consistent).
 *   - One row per (staff, work_date) that has a summary. Staff with no
 *     summary for a given day are omitted (back-office week view shows
 *     the absent days; export is purely payroll-ready).
 *
 * RBAC: `people.staff.attendance.manage` view permission.
 *
 * Side effect: every successful export locks the payroll week (idempotent
 * upsert on attendance_weekly_locks). That's the documented PRD contract
 * — an export pass downstream means corrections for that week must route
 * through an HR-approved unlock. The lock row is owned by the caller's
 * user id, so downstream audit can see who froze the week.
 *
 * Not yet: vendor adapters (Sage / VIP). Phase 1d.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as XLSX from 'xlsx';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';
import {
  withAuth,
  withPermission,
  type AuthenticatedNextApiRequest,
} from '@/lib/auth/middleware';
import { upsertWeeklyLock } from '@/modules/attendance/corrections/lockQueries';

interface ExportRow extends Record<string, unknown> {
  staff_id: string;
  employee_id: string | null;
  full_name: string;
  work_date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  regular_hrs: string;
  overtime_hrs: string;
  sunday_hrs: string;
  holiday_hrs: string;
  night_hrs: string;
  wage_amount_cents: string | null;
  exceptions_count: number;
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

type OutputFormat = 'csv' | 'xlsx';

function parseFormat(raw: unknown): OutputFormat | { error: string } {
  const v = typeof raw === 'string' ? raw.toLowerCase() : 'csv';
  if (v === 'csv' || v === 'xlsx') return v;
  return { error: "format must be 'csv' or 'xlsx'" };
}

// Single source of truth for column order across both the empty-week and
// populated-week paths. Payroll vendor importers depend on the exact
// header sequence — a reorder here silently misaligns imports until
// someone spots the bad first shift. EXPORT_COLUMNS is also the header
// array written to CSV + XLSX.
export const EXPORT_COLUMNS = [
  'staff_id',
  'employee_id',
  'full_name',
  'work_date',
  'clock_in_at',
  'clock_out_at',
  'regular_hrs',
  'overtime_hrs',
  'sunday_hrs',
  'holiday_hrs',
  'night_hrs',
  'wage_amount',
  'exceptions_count',
] as const;

function formatHrs(raw: string | number): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    // NaN from a corrupt numeric is a real audit signal — do NOT render
    // 0.00, that looks like "worked nothing" on payroll. Blank + log so
    // the ops team sees the issue before pay-day.
    log.error('[staff-attendance-export] non-numeric hours value', { raw });
    return '';
  }
  return n.toFixed(2);
}

function formatWage(cents: string | null): string {
  if (cents == null) return '';
  const n = Number(cents);
  if (!Number.isFinite(n)) return '';
  return (n / 100).toFixed(2);
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

  const formatOrError = parseFormat(req.query.format);
  if (typeof formatOrError !== 'string') {
    return apiResponse.badRequest(res, formatOrError.error);
  }
  const format = formatOrError;

  const weekEnd = addDays(weekStart, 6);

  try {
    // Replaced the per-row correlated subquery with a single JOIN against
    // a pre-aggregated exception CTE. At 50-staff × 7-day scale the former
    // was ~350 subquery executions per request — the latter is one scan.
    const rows = await sql<ExportRow>`
      WITH week_exceptions AS (
        SELECT xe.staff_id, xe.work_date, COUNT(*)::int AS exceptions_count
        FROM attendance_exceptions x
        JOIN attendance_entries xe ON xe.id = x.entry_id
        WHERE xe.work_date >= ${weekStart}::date
          AND xe.work_date <= ${weekEnd}::date
          AND x.resolved_at IS NULL
        GROUP BY xe.staff_id, xe.work_date
      ),
      week_entry_bounds AS (
        SELECT staff_id, work_date,
               MIN(clock_in_at)  AS first_clock_in_at,
               MAX(clock_out_at) AS last_clock_out_at
        FROM attendance_entries
        WHERE work_date >= ${weekStart}::date
          AND work_date <= ${weekEnd}::date
        GROUP BY staff_id, work_date
      )
      SELECT
        ds.staff_id,
        s.employee_id,
        TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS full_name,
        ds.work_date::text AS work_date,
        web.first_clock_in_at::text  AS clock_in_at,
        web.last_clock_out_at::text  AS clock_out_at,
        ds.regular_hrs::text,
        ds.overtime_hrs::text,
        ds.sunday_hrs::text,
        ds.holiday_hrs::text,
        ds.night_hrs::text,
        ds.wage_amount_cents::text,
        COALESCE(wx.exceptions_count, 0) AS exceptions_count
      FROM attendance_daily_summaries ds
      JOIN staff s ON s.id = ds.staff_id
      LEFT JOIN week_entry_bounds web
        ON web.staff_id = ds.staff_id AND web.work_date = ds.work_date
      LEFT JOIN week_exceptions wx
        ON wx.staff_id = ds.staff_id AND wx.work_date = ds.work_date
      WHERE ds.work_date >= ${weekStart}::date
        AND ds.work_date <= ${weekEnd}::date
      ORDER BY full_name ASC, ds.work_date ASC
    `;

    const records = rows.map((r) => ({
      staff_id: r.staff_id,
      employee_id: r.employee_id ?? '',
      full_name: r.full_name,
      work_date: r.work_date,
      clock_in_at: r.clock_in_at ?? '',
      clock_out_at: r.clock_out_at ?? '',
      regular_hrs: formatHrs(r.regular_hrs),
      overtime_hrs: formatHrs(r.overtime_hrs),
      sunday_hrs: formatHrs(r.sunday_hrs),
      holiday_hrs: formatHrs(r.holiday_hrs),
      night_hrs: formatHrs(r.night_hrs),
      wage_amount: formatWage(r.wage_amount_cents),
      exceptions_count: r.exceptions_count,
    }));

    // Lock the week BEFORE streaming bytes. If the lock write fails, the
    // payroll vendor would import an unfrozen week — any correction
    // submitted afterwards would silently mutate data that should have
    // been sealed by the export. Loud 500 on lock failure beats silent
    // drift between the CSV file and the DB.
    const actor = (req as AuthenticatedNextApiRequest).user?.id;
    if (!actor) {
      return apiResponse.unauthorized(res);
    }
    try {
      await upsertWeeklyLock({
        weekStartDate: weekStart,
        lockedBy: actor,
        lockReason: `export:${format}`,
      });
    } catch (lockErr) {
      log.error(
        '[staff-attendance-export] weekly lock write failed — refusing to stream export to keep CSV+DB in sync',
        {
          weekStart,
          format,
          error: lockErr instanceof Error ? lockErr.message : String(lockErr),
        }
      );
      return apiResponse.internalError(res, lockErr);
    }

    const filename = `attendance-week-${weekStart}.${format}`;

    if (format === 'csv') {
      const escape = (v: unknown): string => {
        const s = String(v ?? '');
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [EXPORT_COLUMNS.join(',')];
      for (const r of records) {
        lines.push(
          EXPORT_COLUMNS.map((k) => escape((r as Record<string, unknown>)[k])).join(',')
        );
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(lines.join('\r\n'));
    }

    // XLSX: pass EXPORT_COLUMNS explicitly so column order is fixed even
    // if the records array is empty or the record keys change later.
    const worksheet = XLSX.utils.json_to_sheet(records, {
      header: Array.from(EXPORT_COLUMNS),
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(buffer);
  } catch (err) {
    log.error('[staff-attendance-export] unexpected error', {
      weekStart,
      format,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('people.staff.attendance.manage', 'view')(handler));

/**
 * GET /api/staff/attendance-export?week_start=YYYY-MM-DD&format=csv|xlsx
 *                                 [&dry_run=true]
 *
 * Weekly payroll export. Format-agnostic columns per Phase 1b PRD:
 *   staff_id | employee_id | full_name | work_date |
 *   clock_in_at | clock_out_at |
 *   regular_hrs | overtime_hrs | sunday_hrs | holiday_hrs | night_hrs |
 *   wage_amount | hourly_rate | exceptions_count
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
 * Dry-run preview (dry_run=true):
 *   - Does NOT lock the week.
 *   - Does NOT stream CSV / XLSX bytes.
 *   - Returns a JSON summary (rowCount, staffCount, per-bucket hour
 *     totals, total wage in cents, open-exceptions count, existing-
 *     lock flag).
 *   Ops run this before the real export so they can sanity-check the
 *   volume ("is 47 rows roughly what I expect?") without triggering
 *   the lock side effect. Same SELECT as the real export — drift
 *   between preview and actual is impossible.
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
import {
  lookupActiveLock,
  upsertWeeklyLock,
} from '@/modules/attendance/corrections/lockQueries';

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
  hourly_rate_snapshot_cents: string | null;
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
  'hourly_rate',
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

/**
 * Rate snapshot is captured by the reconcile cron at computation time
 * (migration 324). Rendered in rand to two decimals for payroll
 * readability; blank when no rate was set. Migration 324's paired
 * CHECK guarantees this is null iff wage_amount_cents is null, so the
 * two columns together tell the full audit story: either both are
 * blank (rate unset) or both populated (wage computed from that rate).
 */
function formatRate(cents: string | null): string {
  if (cents == null) return '';
  const n = Number(cents);
  if (!Number.isFinite(n)) return '';
  return (n / 100).toFixed(2);
}

/**
 * Coerce a numeric-string (Postgres numeric → text) or nullable number
 * to a finite JS number, defaulting to 0 for null / NaN / undefined.
 * Used in the dry-run aggregator where we'd rather under-count an odd
 * NULL row than corrupt the sum with NaN.
 */
function safeNum(raw: string | number | null | undefined): number {
  if (raw == null) return 0;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
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

  // Dry-run flag — when true, skip the lock write and stream no bytes.
  // The SELECT still runs (so ops see real numbers) and we return a
  // JSON summary instead. Any truthy string turns it on; we accept
  // "true"/"1"/"yes" so the flag works from a link, a curl, or a UI
  // toggle without negotiating on the exact value.
  const dryRun = ['true', '1', 'yes'].includes(
    typeof req.query.dry_run === 'string' ? req.query.dry_run.toLowerCase() : ''
  );

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
        ds.hourly_rate_snapshot_cents::text,
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

    // Dry-run preview — compute summary from the exact rows the real
    // export would write, return JSON, and bail before the lock + bytes.
    // Totals are summed in JS from the already-fetched rows so the
    // preview cannot drift from the eventual export (same SELECT, same
    // numbers). We surface the active-lock status so ops see upfront
    // whether this would be the first export or a re-export attempt.
    if (dryRun) {
      const totals = {
        regular_hrs: 0,
        overtime_hrs: 0,
        sunday_hrs: 0,
        holiday_hrs: 0,
        night_hrs: 0,
        wage_amount_cents: 0,
        exceptions_count: 0,
      };
      const staffIds = new Set<string>();
      for (const r of rows) {
        staffIds.add(r.staff_id);
        totals.regular_hrs += safeNum(r.regular_hrs);
        totals.overtime_hrs += safeNum(r.overtime_hrs);
        totals.sunday_hrs += safeNum(r.sunday_hrs);
        totals.holiday_hrs += safeNum(r.holiday_hrs);
        totals.night_hrs += safeNum(r.night_hrs);
        totals.wage_amount_cents += safeNum(r.wage_amount_cents);
        totals.exceptions_count += Number(r.exceptions_count) || 0;
      }
      const existingLock = await lookupActiveLock(weekStart);
      return apiResponse.success(res, {
        dryRun: true,
        weekStart,
        weekEnd,
        format,
        rowCount: rows.length,
        staffCount: staffIds.size,
        totals: {
          regular_hrs: totals.regular_hrs.toFixed(2),
          overtime_hrs: totals.overtime_hrs.toFixed(2),
          sunday_hrs: totals.sunday_hrs.toFixed(2),
          holiday_hrs: totals.holiday_hrs.toFixed(2),
          night_hrs: totals.night_hrs.toFixed(2),
          wage_amount: (totals.wage_amount_cents / 100).toFixed(2),
          wage_amount_cents: totals.wage_amount_cents,
          exceptions_count: totals.exceptions_count,
        },
        alreadyLocked: existingLock !== null,
        existingLock: existingLock
          ? {
              lockedBy: existingLock.locked_by,
              lockedAt: existingLock.locked_at,
              lockReason: existingLock.lock_reason,
            }
          : null,
      });
    }

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
      hourly_rate: formatRate(r.hourly_rate_snapshot_cents),
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

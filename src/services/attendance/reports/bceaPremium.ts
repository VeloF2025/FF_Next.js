/**
 * bcea-premium report (PRD-061 FR-REPORT-BC-*).
 *
 * Hours worked on Sundays and public holidays per staff per day. Joins
 * `attendance_daily_summaries.work_date` against `public_holidays` to
 * label the day type — Sunday OR a specific holiday name. Premium rate
 * is the BCEA-default rule (1.5× ordinary for Sundays s16, 2× for
 * holidays s18, 2× for Sunday-non-ordinary). We use the staff's
 * `ordinarily_works_sundays` flag to pick the Sunday multiplier.
 *
 * Premium amount is `hours × multiplier × hourly_rate_at_clock_in`.
 * Where the snapshot is missing, multiplier and amount are still shown
 * but the amount is 0 and the row is footnoted via `notes`.
 */

import { sql } from '@/lib/db-pool';
import { buildBaseWhere, makeParamBuilder } from './sqlHelpers';
import { ReportTooLargeError, REPORT_ROW_CAP } from './runner';
import type { ReportColumn, ReportInput, ReportRunResult } from './types';

const COLUMNS: ReadonlyArray<ReportColumn> = [
  { key: 'work_date', label: 'Date' },
  { key: 'day_type', label: 'Day type' },
  { key: 'staff', label: 'Staff' },
  { key: 'department', label: 'Dept' },
  { key: 'hours_worked', label: 'Hours', align: 'right', format: 'number' },
  { key: 'multiplier', label: 'BCEA ×', align: 'right', format: 'number' },
  { key: 'premium_amount_rand', label: 'Premium (R)', align: 'right', format: 'currency_rand' },
];

interface Row extends Record<string, unknown> {
  work_date: string;
  staff_id: string;
  full_name: string;
  department: string | null;
  ordinarily_works_sundays: boolean | null;
  is_sunday: boolean;
  holiday_name: string | null;
  sunday_hrs: string;
  holiday_hrs: string;
  hourly_rate_cents: string | null;
}

export async function runBceaPremium(input: ReportInput): Promise<ReportRunResult> {
  if (!input.dateFrom || !input.dateTo) {
    return { rows: [], columns: COLUMNS, notes: ['Date range is required.'] };
  }
  const pb = makeParamBuilder();
  const where = buildBaseWhere({
    pb,
    scopedStaffIds: input.scopedStaffIds,
    staffIdRef: 'ds.staff_id',
    workDateRef: 'ds.work_date',
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    departments: input.departments,
    deptRef: 's.department',
    activeStaffRefs: { isActive: 's.is_active', endDate: 's.end_date' },
  });
  const onlyPremiumDays = `(ds.sunday_hrs > 0 OR ds.holiday_hrs > 0)`;
  const siteFilterSql = input.siteIds.length > 0
    ? ` AND EXISTS (
        SELECT 1 FROM attendance_entries e
         WHERE e.staff_id = ds.staff_id
           AND e.work_date = ds.work_date
           AND e.site_geofence_id = ANY(${pb.next(input.siteIds)}::uuid[]))`
    : '';

  const text = `
    SELECT
      ds.work_date::text                           AS work_date,
      ds.staff_id::text                            AS staff_id,
      TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS full_name,
      s.department                                 AS department,
      s.ordinarily_works_sundays                   AS ordinarily_works_sundays,
      (EXTRACT(DOW FROM ds.work_date) = 0)         AS is_sunday,
      ph.name                                      AS holiday_name,
      ds.sunday_hrs::text                          AS sunday_hrs,
      ds.holiday_hrs::text                         AS holiday_hrs,
      sras.hourly_rate_cents::text                 AS hourly_rate_cents
    FROM attendance_daily_summaries ds
    JOIN staff s ON s.id = ds.staff_id
    LEFT JOIN public_holidays ph ON ph.date = ds.work_date
    -- Pick a single representative entry per (staff, day) for the rate snapshot.
    LEFT JOIN LATERAL (
      SELECT id FROM attendance_entries e
       WHERE e.staff_id = ds.staff_id AND e.work_date = ds.work_date
       ORDER BY e.clock_in_at ASC
       LIMIT 1
    ) e_pick ON TRUE
    LEFT JOIN staff_rate_at_clock_in sras ON sras.entry_id = e_pick.id
    WHERE ${where} AND ${onlyPremiumDays}${siteFilterSql}
    ORDER BY ds.work_date DESC, full_name ASC
  `;

  const rows = await sql.query<Row>(text, pb.params);
  if (rows.length > REPORT_ROW_CAP) throw new ReportTooLargeError(rows.length);
  let missingRate = 0;
  const out: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    // BCEA s16 (Sunday work) and s18 (holiday work) each set a *minimum*
    // multiplier; the higher applies when both classifications hit the
    // same hour. We emit ONE row per (staff, date) with the higher
    // multiplier — emitting two would double-count the same hours and
    // overstate the premium total payroll consumers SUM out of the
    // spreadsheet.
    const sundayHrs = Number(r.sunday_hrs);
    const holidayHrs = Number(r.holiday_hrs);
    if (sundayHrs === 0 && holidayHrs === 0) continue;
    const rateCents = r.hourly_rate_cents !== null ? Number(r.hourly_rate_cents) : null;
    if (rateCents === null) missingRate += 1;

    const sundayMultiplier = r.ordinarily_works_sundays ? 1.5 : 2.0;
    const isBoth = sundayHrs > 0 && holidayHrs > 0;
    const isHolidayOnly = sundayHrs === 0 && holidayHrs > 0;
    let dayType: string;
    let multiplier: number;
    let hours: number;
    if (isBoth) {
      // Holiday on a Sunday: take the higher multiplier (2× holiday) and
      // the larger of the two hour buckets (they should coincide, but the
      // calculator could conceivably populate them differently).
      dayType = `${r.holiday_name ?? 'Public holiday'} (Sunday)`;
      multiplier = Math.max(sundayMultiplier, 2.0);
      hours = Math.max(sundayHrs, holidayHrs);
    } else if (isHolidayOnly) {
      dayType = r.holiday_name ?? 'Public holiday';
      multiplier = 2.0;
      hours = holidayHrs;
    } else {
      dayType = 'Sunday';
      multiplier = sundayMultiplier;
      hours = sundayHrs;
    }
    const amount = rateCents === null ? 0 : (hours * multiplier * rateCents) / 100;
    out.push({
      work_date: r.work_date,
      day_type: dayType,
      staff: r.full_name,
      department: r.department ?? '',
      hours_worked: hours,
      multiplier,
      premium_amount_rand: Number(amount.toFixed(2)),
    });
  }
  const notes: string[] = [];
  if (missingRate > 0) {
    notes.push(`${missingRate} row(s) had no captured hourly rate; premium amount shows R0 — verify via payroll.`);
  }
  notes.push('Sunday multiplier 1.5× when staff ordinarily works Sundays, 2× otherwise (BCEA s16). Holiday 2× (BCEA s18). Holiday-on-Sunday: higher multiplier wins, single row per day.');
  return { rows: out, columns: COLUMNS, notes };
}

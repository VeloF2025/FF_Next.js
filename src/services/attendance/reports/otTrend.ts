/**
 * ot-trend report (PRD-061 FR-REPORT-OT-*).
 *
 * Per-staff overtime hours for each of the last 12 ISO weeks (week 0 =
 * the week containing today, week 11 = 11 weeks ago). The runner has
 * already pinned dateFrom/dateTo to that span. Columns w-11..w-0 plus
 * total_ot_hours.
 *
 * No inline-image sparkline today (Phase C2 polish) — the values give
 * the spreadsheet user everything to chart manually if needed.
 */

import { sql } from '@/lib/db-pool';
import { buildBaseWhere, makeParamBuilder } from './sqlHelpers';
import type { ReportColumn, ReportInput, ReportRunResult } from './types';

const NUM_WEEKS = 12;

interface Row extends Record<string, unknown> {
  staff_id: string;
  full_name: string;
  department: string | null;
  /** Postgres date_trunc('week', ...) — Monday of the ISO week. */
  week_monday: string;
  ot_hours: string;
}

export async function runOtTrend(input: ReportInput): Promise<ReportRunResult> {
  if (!input.dateFrom || !input.dateTo) {
    return { rows: [], columns: [], notes: ['Date range is required.'] };
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

  const text = `
    SELECT
      ds.staff_id::text                            AS staff_id,
      TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS full_name,
      s.department,
      date_trunc('week', ds.work_date)::date::text AS week_monday,
      COALESCE(SUM(ds.overtime_hrs), 0)::text      AS ot_hours
    FROM attendance_daily_summaries ds
    JOIN staff s ON s.id = ds.staff_id
    WHERE ${where}
    GROUP BY ds.staff_id, s.first_name, s.last_name, s.department, date_trunc('week', ds.work_date)
    ORDER BY full_name ASC, week_monday ASC
  `;
  const rows = await sql.query<Row>(text, pb.params);

  // Build the ISO-week column list anchored on dateTo. Postgres'
  // date_trunc('week', ...) returns the Monday of that ISO week, which
  // matches our payroll convention.
  const tail = new Date(`${input.dateTo}T00:00:00Z`);
  const tailDow = tail.getUTCDay(); // 0=Sun…6=Sat
  const diffToMon = tailDow === 0 ? -6 : 1 - tailDow;
  tail.setUTCDate(tail.getUTCDate() + diffToMon);
  const weekKeys: string[] = [];
  for (let i = NUM_WEEKS - 1; i >= 0; i--) {
    const d = new Date(tail);
    d.setUTCDate(d.getUTCDate() - i * 7);
    weekKeys.push(d.toISOString().slice(0, 10));
  }

  const columns: ReportColumn[] = [
    { key: 'staff', label: 'Staff' },
    { key: 'department', label: 'Dept' },
    ...weekKeys.map((wk, idx): ReportColumn => ({
      key: `w_${wk}`,
      label: idx === NUM_WEEKS - 1 ? 'this wk' : `w-${NUM_WEEKS - 1 - idx}`,
      align: 'right',
      format: 'number',
    })),
    { key: 'total_ot_hours', label: 'Total OT', align: 'right', format: 'number' },
  ];

  // Pivot: staff → { weekKey: hours }
  const byStaff = new Map<string, {
    full_name: string;
    department: string;
    weeks: Map<string, number>;
  }>();
  for (const r of rows) {
    const ot = Number(r.ot_hours);
    if (!byStaff.has(r.staff_id)) {
      byStaff.set(r.staff_id, {
        full_name: r.full_name,
        department: r.department ?? '',
        weeks: new Map(),
      });
    }
    byStaff.get(r.staff_id)!.weeks.set(r.week_monday, ot);
  }
  const out = Array.from(byStaff.values())
    .map((rec) => {
      const row: Record<string, unknown> = {
        staff: rec.full_name,
        department: rec.department,
      };
      let total = 0;
      for (const wk of weekKeys) {
        const v = rec.weeks.get(wk) ?? 0;
        row[`w_${wk}`] = v;
        total += v;
      }
      row.total_ot_hours = total;
      return row;
    })
    .sort((a, b) => String(a.staff).localeCompare(String(b.staff)));

  return { rows: out, columns, notes: [
    'Sparkline column not rendered in this PR — Phase C2 polish.',
  ] };
}

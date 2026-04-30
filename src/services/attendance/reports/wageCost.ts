/**
 * wage-cost report (PRD-061 FR-REPORT-WC-*).
 *
 * Sum of `wage_amount_cents` over a date range, grouped by `dept`,
 * `site` (the staff's home_site_id), or `none` (single-row total).
 * `project` group-by is listed in the catalogue's options but no-op'd
 * today — staff↔project linkage isn't on attendance rows yet
 * (PRD §14 #5 / Phase C2).
 *
 * Headcount is "distinct staff with rows in the window".
 */

import { sql } from '@/lib/db-pool';
import { buildBaseWhere, makeParamBuilder } from './sqlHelpers';
import type { ReportColumn, ReportInput, ReportRunResult } from './types';

interface Row extends Record<string, unknown> {
  group_label: string;
  headcount: number;
  hours: string;
  ot_wage_cents: string | null;
  total_wage_cents: string | null;
}

export async function runWageCost(input: ReportInput): Promise<ReportRunResult> {
  if (!input.dateFrom || !input.dateTo) {
    return { rows: [], columns: [], notes: ['Date range is required.'] };
  }
  const groupBy = (input.groupBy ?? 'dept') as 'dept' | 'site' | 'none';

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

  let groupCol: string;
  let groupLabel: string;
  switch (groupBy) {
    case 'site':
      groupCol = `COALESCE(home_site.name, '(no home site)')`;
      groupLabel = 'Site';
      break;
    case 'none':
      groupCol = `'(total)'`;
      groupLabel = '';
      break;
    case 'dept':
    default:
      groupCol = `COALESCE(s.department, '(unassigned)')`;
      groupLabel = 'Department';
      break;
  }
  const joinHomeSite = groupBy === 'site'
    ? 'LEFT JOIN fleet_authorized_locations home_site ON home_site.id = s.home_site_id'
    : '';

  // CRITICAL: pick a single representative entry per (staff, date) via
  // LATERAL — a non-LATERAL LEFT JOIN to attendance_entries fans `ds` out
  // by entry-count, multiplying every aggregate (hours, wage_amount_cents)
  // by the duplicate factor. Same pattern as bceaPremium.ts.
  //
  // For OT-wage rounding: keep numeric precision through the SUM and
  // ROUND once at the end so 0.25h × 1.5 × 14550 cents = 5456.25 doesn't
  // silently truncate to 5456 per row.
  const text = `
    SELECT
      ${groupCol}                                  AS group_label,
      COUNT(DISTINCT ds.staff_id)::int             AS headcount,
      COALESCE(SUM(ds.regular_hrs + ds.overtime_hrs), 0)::text AS hours,
      ROUND(COALESCE(SUM(
        CASE WHEN sras.hourly_rate_cents IS NULL THEN 0::numeric
             ELSE ds.overtime_hrs * 1.5 * sras.hourly_rate_cents
        END
      ), 0))::text                                 AS ot_wage_cents,
      COALESCE(SUM(ds.wage_amount_cents), 0)::text AS total_wage_cents
    FROM attendance_daily_summaries ds
    JOIN staff s ON s.id = ds.staff_id
    LEFT JOIN LATERAL (
      SELECT id FROM attendance_entries e
       WHERE e.staff_id = ds.staff_id AND e.work_date = ds.work_date
       ORDER BY e.clock_in_at ASC
       LIMIT 1
    ) e_pick ON TRUE
    LEFT JOIN staff_rate_at_clock_in sras ON sras.entry_id = e_pick.id
    ${joinHomeSite}
    WHERE ${where}
    GROUP BY group_label
    ORDER BY group_label ASC
  `;
  const rows = await sql.query<Row>(text, pb.params);

  const columns: ReportColumn[] = [
    { key: 'group_label', label: groupLabel || 'Total' },
    { key: 'headcount', label: 'Active staff', align: 'right', format: 'integer' },
    { key: 'hours', label: 'Hours', align: 'right', format: 'number' },
    { key: 'ot_wage_rand', label: 'OT wage (R, est.)', align: 'right', format: 'currency_rand' },
    { key: 'total_wage_rand', label: 'Total wage (R)', align: 'right', format: 'currency_rand' },
  ];

  return {
    rows: rows.map((r) => ({
      group_label: r.group_label,
      headcount: r.headcount,
      hours: Number(r.hours),
      ot_wage_rand: r.ot_wage_cents === null ? 0 : Number(r.ot_wage_cents) / 100,
      total_wage_rand: r.total_wage_cents === null ? 0 : Number(r.total_wage_cents) / 100,
    })),
    columns,
    notes: [
      'OT wage is best-effort — rows without a captured hourly_rate snapshot contribute 0.',
      groupBy === 'none' ? 'Grouping = none → single-row total.' : `Grouping = ${groupLabel.toLowerCase()}.`,
    ],
  };
}

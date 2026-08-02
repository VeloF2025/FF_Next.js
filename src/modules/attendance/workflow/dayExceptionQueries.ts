import { query } from '@/lib/db-pool';
import { resolveScope } from '@/services/attendance/search/scope';

import { mapDayException, type DayExceptionRow } from './dayExceptionMapping';
import type { DayExceptionListArgs, DayExceptionListResult } from './types';

const SELECT_QUEUE = `
  SELECT de.id AS exception_id, de.staff_id,
         TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS staff_name,
         s.department AS crew_name, TO_CHAR(de.work_date, 'YYYY-MM-DD') AS work_date,
         de.entry_id, de.kind, de.status, de.owner_user_id, de.proposed_hours,
         de.classification AS exception_classification, de.result_version,
         de.created_at::text,
         e.clock_in_at::text, e.clock_out_at::text,
         (e.clock_in_lat IS NOT NULL AND e.clock_in_lon IS NOT NULL) AS clock_in_gps_available,
         (e.clock_out_lat IS NOT NULL AND e.clock_out_lon IS NOT NULL) AS clock_out_gps_available,
         (e.selfie_in_url IS NOT NULL) AS selfie_in_available,
         (e.selfie_out_url IS NOT NULL) AS selfie_out_available,
         e.site_geofence_id AS site_id, site.name AS site_name,
         a.id AS adjustment_id, a.adjustment_kind,
         a.adjusted_clock_in_at::text, a.adjusted_clock_out_at::text,
         a.reason AS adjustment_reason, a.status AS adjustment_status,
         ds.result_status, ds.scheduled_paid_hrs, ds.recorded_elapsed_hrs,
         ds.proposed_regular_hrs, ds.proposed_overtime_hrs,
         ds.proposed_sunday_hrs, ds.proposed_holiday_hrs,
         ds.approved_regular_hrs, ds.approved_overtime_hrs,
         ds.approved_sunday_hrs, ds.approved_holiday_hrs,
         ds.leave_hrs, ds.unpaid_hrs, ds.attendance_classification, ds.blocking_reasons
  FROM attendance_day_exceptions de
  JOIN staff s ON s.id = de.staff_id
  JOIN attendance_daily_summaries ds
    ON ds.staff_id = de.staff_id AND ds.work_date = de.work_date
  LEFT JOIN attendance_entries e ON e.id = de.entry_id AND e.staff_id = de.staff_id
  LEFT JOIN attendance_adjustments a ON a.id = de.adjustment_id AND a.entry_id = de.entry_id
  LEFT JOIN fleet_authorized_locations site ON site.id = e.site_geofence_id`;

function filterSql(scoped: boolean): string {
  return `
    WHERE ($1::text = 'all'
       OR ($1::text = 'unresolved' AND de.status IN ('open', 'awaiting_worker', 'awaiting_supervisor'))
       OR de.status = $1::text)
      AND ($2::text IS NULL OR de.kind = $2::text)
      ${scoped ? 'AND de.staff_id = ANY($3::uuid[])' : ''}
    ORDER BY CASE de.kind
      WHEN 'missing_clock_in' THEN 1 WHEN 'missing_clock_out' THEN 2
      WHEN 'sunday_work' THEN 3 WHEN 'public_holiday_work' THEN 4 ELSE 5 END,
      de.work_date ASC, de.created_at ASC
    LIMIT $${scoped ? 4 : 3}::int`;
}

export async function listDayExceptions(args: DayExceptionListArgs): Promise<DayExceptionListResult> {
  const limit = Math.min(Math.max(Math.trunc(args.limit), 1), 200);
  const scope = await resolveScope(args.user);
  if (scope.allowedStaffIds?.length === 0) {
    return { items: [], limit, status: args.status, scope: scope.note };
  }
  const rows = scope.allowedStaffIds === null
    ? await query<DayExceptionRow>(`${SELECT_QUEUE}${filterSql(false)}`, [args.status, args.kind ?? null, limit])
    : await query<DayExceptionRow>(`${SELECT_QUEUE}${filterSql(true)}`, [
      args.status, args.kind ?? null, scope.allowedStaffIds, limit,
    ]);
  const allowed = scope.allowedStaffIds === null ? null : new Set(scope.allowedStaffIds);
  return {
    items: rows.filter((row) => allowed === null || allowed.has(row.staff_id)).map(mapDayException),
    limit, status: args.status, scope: scope.note,
  };
}

export { DayExceptionWorkflowError, decideDayException } from './dayExceptionDecision';
export type { DayExceptionListResult, DayExceptionDecisionResult } from './types';

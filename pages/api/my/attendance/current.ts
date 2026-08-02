/**
 * GET /api/my/attendance/current
 *
 * Returns the currently-open attendance entry for the signed-in staff
 * member, or null. Drives the portal home screen — lets the UI decide
 * whether to render "Clock In" or "Clock Out" without a round-trip
 * through the history endpoint.
 */

import { apiResponse } from '@/lib/apiResponse';
import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { findOpenEntry, sastWorkDate } from '@/modules/attendance/portal/clockUtils';
import { findRequiredAttendanceAction } from '@/modules/attendance/workflow/requiredActionQueries';

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

export default withMySession(async (req, res, session) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const workDate = sastWorkDate(new Date());
    const [open, stateRows, requiredAttendanceAction] = await Promise.all([
      findOpenEntry(session.staffId),
      loadCurrentDayState(session.staffId, workDate),
      findRequiredAttendanceAction(session.staffId, workDate),
    ]);
    const state = stateRows[0];
    if (!state) throw new Error(`No effective attendance policy for ${workDate}`);

    return apiResponse.success(res, {
      workDate,
      open: open ? {
          entryId: open.id,
          workDate: open.work_date,
          clockInAt: open.clock_in_at,
          siteGeofenceId: open.site_geofence_id,
          vehicleAssignmentId: open.vehicle_assignment_id,
          selfieInUrl: open.selfie_in_url,
        } : null,
      schedule: {
        policyId: state.policy_id,
        timezone: state.timezone,
        start: state.schedule_start,
        end: state.schedule_end,
        unpaidBreakMinutes: Number(state.unpaid_break_minutes),
        scheduledPaidHours: Number(state.scheduled_paid_hours),
      },
      result: {
        status: state.result_status ?? (open ? 'open' : 'expected'),
        recordedElapsedHours: numberOrNull(state.recorded_elapsed_hours),
        scheduledPaidHours:
          numberOrNull(state.result_scheduled_paid_hours) ?? Number(state.scheduled_paid_hours),
      },
      requiredAttendanceAction,
    });
  } catch (err) {
    log.error('[my-attendance-current] unexpected error', {
      staffId: session.staffId,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  }
});

interface CurrentDayStateRow extends Record<string, unknown> {
  policy_id: string;
  timezone: string;
  schedule_start: string | null;
  schedule_end: string | null;
  unpaid_break_minutes: number;
  scheduled_paid_hours: string;
  result_status: string | null;
  recorded_elapsed_hours: string | null;
  result_scheduled_paid_hours: string | null;
}

function loadCurrentDayState(staffId: string, workDate: string): Promise<CurrentDayStateRow[]> {
  return sql<CurrentDayStateRow>`
    WITH effective_policy AS (
      SELECT *
      FROM attendance_schedule_policies
      WHERE active_from <= ${workDate}::date
        AND (active_to IS NULL OR active_to >= ${workDate}::date)
      ORDER BY active_from DESC
      LIMIT 1
    )
    SELECT p.id AS policy_id,
           p.timezone,
           CASE
             WHEN EXTRACT(ISODOW FROM ${workDate}::date) BETWEEN 1 AND 5
               THEN TO_CHAR(p.weekday_start, 'HH24:MI')
             WHEN EXTRACT(ISODOW FROM ${workDate}::date) = 6
               THEN TO_CHAR(p.saturday_start, 'HH24:MI')
             ELSE NULL
           END AS schedule_start,
           CASE
             WHEN EXTRACT(ISODOW FROM ${workDate}::date) BETWEEN 1 AND 5
               THEN TO_CHAR(p.weekday_end, 'HH24:MI')
             WHEN EXTRACT(ISODOW FROM ${workDate}::date) = 6
               THEN TO_CHAR(p.saturday_end, 'HH24:MI')
             ELSE NULL
           END AS schedule_end,
           CASE
             WHEN EXTRACT(ISODOW FROM ${workDate}::date) BETWEEN 1 AND 5
               THEN p.weekday_unpaid_break_minutes
             ELSE 0
           END AS unpaid_break_minutes,
           CASE
             WHEN EXTRACT(ISODOW FROM ${workDate}::date) BETWEEN 1 AND 5
               THEN p.weekday_paid_cap_hrs
             WHEN EXTRACT(ISODOW FROM ${workDate}::date) = 6
               THEN p.saturday_paid_cap_hrs
             ELSE 0
           END::text AS scheduled_paid_hours,
           ds.result_status,
           ds.recorded_elapsed_hrs::text AS recorded_elapsed_hours,
           ds.scheduled_paid_hrs::text AS result_scheduled_paid_hours
    FROM effective_policy p
    LEFT JOIN attendance_daily_summaries ds
      ON ds.staff_id = ${staffId}::uuid
     AND ds.work_date = ${workDate}::date
  `;
}

function numberOrNull(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid persisted attendance hours '${value}'`);
  return parsed;
}

/**
 * POST /api/staff/attendance-manual-entry
 *
 * Supervisor clock-in-on-behalf for staff without phones.
 *
 * Body: {
 *   staff_id,
 *   clock_in_at, clock_out_at,    // ISO timestamps; must bracket a SAST day
 *   site_geofence_id?,             // optional
 *   notes                          // required — audit trail
 * }
 *
 * Writes one attendance_entries row with status='manual' and raises a
 * `manual_override` exception for supervisor-attestation audit.
 *
 * Rejects when the computed SAST work_date falls in a locked payroll week.
 *
 * RBAC: people.staff.attendance.corrections, edit (same role that can
 * approve corrections can also supervisor-create entries).
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
import { sastWorkDate } from '@/modules/attendance/portal/clockUtils';
import {
  isoWeekMonday,
  lookupActiveLock,
} from '@/modules/attendance/corrections/lockQueries';
import { authorizedToSuperviseStaff } from '@/services/attendance/supervisorScope';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
    return;
  }
  const actor = (req as AuthenticatedNextApiRequest).user?.id;
  if (!actor) {
    apiResponse.unauthorized(res);
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const staffId = typeof body.staff_id === 'string' ? body.staff_id : '';
  const clockInRaw = typeof body.clock_in_at === 'string' ? body.clock_in_at : '';
  const clockOutRaw = typeof body.clock_out_at === 'string' ? body.clock_out_at : '';
  const siteGeofenceId =
    typeof body.site_geofence_id === 'string' ? body.site_geofence_id : null;
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';

  if (!staffId) {
    apiResponse.badRequest(res, 'staff_id is required');
    return;
  }
  // Scope gate: supervisor can only act on staff in their supervisor
  // chain. Super_admin / admin bypass.
  const scopeOk = await authorizedToSuperviseStaff(
    (req as AuthenticatedNextApiRequest).user,
    staffId
  );
  if (!scopeOk) {
    apiResponse.forbidden(
      res,
      'You are not in the supervisor chain for this staff member'
    );
    return;
  }
  if (!clockInRaw || !clockOutRaw) {
    apiResponse.badRequest(res, 'clock_in_at and clock_out_at are required (ISO)');
    return;
  }
  if (notes.length < 10) {
    apiResponse.badRequest(res, 'notes must be at least 10 characters (audit requirement)');
    return;
  }
  const clockInAt = new Date(clockInRaw);
  const clockOutAt = new Date(clockOutRaw);
  if (Number.isNaN(clockInAt.getTime()) || Number.isNaN(clockOutAt.getTime())) {
    apiResponse.badRequest(res, 'clock_in_at and clock_out_at must be valid ISO timestamps');
    return;
  }
  if (clockOutAt.getTime() <= clockInAt.getTime()) {
    apiResponse.badRequest(res, 'clock_out_at must be strictly after clock_in_at');
    return;
  }
  const durationHrs = (clockOutAt.getTime() - clockInAt.getTime()) / 3_600_000;
  if (durationHrs > 24) {
    apiResponse.badRequest(res, 'clock_out_at minus clock_in_at must be ≤ 24 hours');
    return;
  }

  const workDate = sastWorkDate(clockInAt);
  const weekMonday = isoWeekMonday(workDate);
  const activeLock = await lookupActiveLock(weekMonday);
  if (activeLock) {
    apiResponse.conflict(
      res,
      `Week ${weekMonday} is locked; unlock first before creating a manual entry`
    );
    return;
  }

  try {
    const rows = await sql<{ id: string }>`
      INSERT INTO attendance_entries (
        staff_id, work_date,
        clock_in_at, clock_out_at,
        client_occurred_at_in, client_occurred_at_out,
        received_at_in, received_at_out,
        site_geofence_id,
        status, notes
      ) VALUES (
        ${staffId}, ${workDate}::date,
        ${clockInAt.toISOString()}, ${clockOutAt.toISOString()},
        ${clockInAt.toISOString()}, ${clockOutAt.toISOString()},
        NOW(), NOW(),
        ${siteGeofenceId},
        'manual', ${notes}
      )
      RETURNING id
    `;
    const created = rows[0];
    if (!created) {
      throw new Error('INSERT returned no row');
    }
    await sql`
      INSERT INTO attendance_exceptions (entry_id, exception_kind, severity, details)
      VALUES (
        ${created.id},
        'manual_override',
        'info',
        jsonb_build_object(
          'supervisor_user_id', ${actor}::text,
          'reason', ${notes}
        )
      )
    `;
    // Invalidate any existing summary so reconcile re-creates it from the new entry.
    await sql`
      DELETE FROM attendance_daily_summaries
      WHERE staff_id = ${staffId} AND work_date = ${workDate}::date
    `;
    apiResponse.success(res, { entry_id: created.id, work_date: workDate });
  } catch (err) {
    log.error('[staff-manual-entry] insert failed', {
      staffId,
      workDate,
      actor,
      error: err instanceof Error ? err.message : String(err),
    });
    apiResponse.internalError(res, err);
  }
}

export default withAuth(
  withPermission('people.staff.attendance.corrections', 'edit')(handler)
);

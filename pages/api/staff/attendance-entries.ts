/**
 * GET /api/staff/attendance-entries?staffId=<uuid>&days=30
 *
 * Admin view of a specific staff member's attendance entries + their
 * exceptions, most-recent first. Powers the TimeAttendanceTab in
 * StaffDetail.
 *
 * RBAC:
 *   - Viewing requires `people.staff.tabs.attendance` (HR + supervisors).
 *   - Sensitive-data access is enforced by the tab-gating in StaffDetail
 *     itself; at the API layer we trust the permission check.
 *
 * Flattened route (not /[staffId]/attendance/...) because nested dynamic
 * routes fail on Vercel per CLAUDE.md.
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
import { authorizedToSuperviseStaff } from '@/services/attendance/supervisorScope';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const MAX_ENTRIES = 500;

interface EntryRow extends Record<string, unknown> {
  id: string;
  work_date: string;
  clock_in_at: string;
  clock_out_at: string | null;
  clock_in_lat: number | null;
  clock_in_lon: number | null;
  clock_out_lat: number | null;
  clock_out_lon: number | null;
  status: 'open' | 'closed' | 'auto_closed' | 'disputed' | 'manual';
  site_geofence_id: string | null;
  vehicle_assignment_id: string | null;
  selfie_in_url: string | null;
  selfie_out_url: string | null;
  notes: string | null;
}

interface ExceptionRow extends Record<string, unknown> {
  id: string;
  entry_id: string;
  exception_kind: string;
  severity: string;
  detected_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const staffId = typeof req.query.staffId === 'string' ? req.query.staffId.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(staffId)) {
    return apiResponse.badRequest(res, 'staffId must be a UUID');
  }

  // Scope gate: a user with view permission may still only see entries
  // for staff they supervise (reports_to ancestor OR same-dept manager).
  // Super_admin / admin bypass. Self-view works via the V===T branch.
  const scopeOk = await authorizedToSuperviseStaff(
    (req as AuthenticatedNextApiRequest).user,
    staffId
  );
  if (!scopeOk) {
    return apiResponse.forbidden(
      res,
      'You are not in the supervisor chain for this staff member'
    );
  }

  const daysRaw = typeof req.query.days === 'string' ? Number.parseInt(req.query.days, 10) : NaN;
  const days = Math.min(
    Math.max(Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : DEFAULT_DAYS, 1),
    MAX_DAYS
  );

  try {
    const entries = await sql<EntryRow>`
      SELECT
        id, work_date::text AS work_date,
        clock_in_at, clock_out_at,
        clock_in_lat::float AS clock_in_lat,
        clock_in_lon::float AS clock_in_lon,
        clock_out_lat::float AS clock_out_lat,
        clock_out_lon::float AS clock_out_lon,
        status, site_geofence_id, vehicle_assignment_id,
        selfie_in_url, selfie_out_url, notes
      FROM attendance_entries
      WHERE staff_id = ${staffId}
        AND clock_in_at > NOW() - (${days}::text || ' days')::interval
      ORDER BY clock_in_at DESC
      LIMIT ${MAX_ENTRIES}
    `;
    if (entries.length >= MAX_ENTRIES) {
      log.warn('[staff-attendance-entries] result capped at MAX_ENTRIES', {
        staffId, days, cap: MAX_ENTRIES,
      });
    }

    const entryIds = entries.map((e) => e.id);
    const exceptions = entryIds.length
      ? await sql<ExceptionRow>`
          SELECT id, entry_id, exception_kind, severity,
                 detected_at, resolved_at, resolution_note
          FROM attendance_exceptions
          WHERE entry_id = ANY(${entryIds}::uuid[])
          ORDER BY detected_at DESC
        `
      : [];

    return apiResponse.success(res, {
      days,
      entries: entries.map((e) => ({
        entryId: e.id,
        workDate: e.work_date,
        clockInAt: e.clock_in_at,
        clockOutAt: e.clock_out_at,
        clockInLat: e.clock_in_lat,
        clockInLon: e.clock_in_lon,
        clockOutLat: e.clock_out_lat,
        clockOutLon: e.clock_out_lon,
        status: e.status,
        siteGeofenceId: e.site_geofence_id,
        vehicleAssignmentId: e.vehicle_assignment_id,
        // Only booleans leave this endpoint — the actual selfie URL is a
        // nginx-served `/storage/...` path with no per-request auth, so
        // possession of the URL is effectively possession of the image.
        // Admins who WANT to view a selfie call /api/staff/attendance-selfie
        // which (a) enforces the stricter `people.staff.attendance.manage`
        // permission and (b) writes the POPIA access-log row.
        hasSelfieIn: e.selfie_in_url != null,
        hasSelfieOut: e.selfie_out_url != null,
        notes: e.notes,
      })),
      exceptions: exceptions.map((x) => ({
        exceptionId: x.id,
        entryId: x.entry_id,
        kind: x.exception_kind,
        severity: x.severity,
        detectedAt: x.detected_at,
        resolvedAt: x.resolved_at,
        resolutionNote: x.resolution_note,
      })),
    });
  } catch (err) {
    log.error('[staff-attendance-entries] unexpected error', {
      staffId,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('people.staff.tabs.attendance', 'view')(handler));

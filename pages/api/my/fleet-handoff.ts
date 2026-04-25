/**
 * POST /api/my/fleet-handoff
 *
 * SSO bridge from /my staff portal → /fleet/portal. PRD-040 Phase 2.
 *
 * The /my session is the authoritative identity. When the staff has an
 * active vehicle assignment and taps the "My Vehicle" tile on the hub,
 * this endpoint mints a real ff_portal_session cookie pointing at their
 * assigned vehicle. The /fleet/portal page then sees a valid session and
 * skips the plate-photo capture step entirely — no second login.
 *
 * Failure modes:
 *   - 401: no /my session (handled by withMySession).
 *   - 404: /my-authenticated user has no active vehicle assignment.
 *          They shouldn't have seen the tile in the first place; respond
 *          cleanly so the hub can hide it on a subsequent reload.
 *   - 500: helper threw (DB / signing key missing).
 *
 * The contractor plate-photo flow is utterly untouched — they don't have
 * a /my session, so they never hit this endpoint.
 */

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { findActiveVehicleAssignment } from '@/modules/attendance/portal/clockUtils';
import { createPortalSession } from '@/modules/fleet/portal/createPortalSession';

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

export default withMySession(async (req, res, session) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  try {
    const assignment = await findActiveVehicleAssignment(session.staffId);
    if (!assignment) {
      log.info('[my/fleet-handoff] no active vehicle', { staffId: session.staffId });
      return apiResponse.notFound(res, 'Active vehicle assignment', session.staffId);
    }

    // Pull the vehicle row + the staff name in one round-trip — both
    // are needed for the portal session payload, and we already know the
    // assignment row from findActiveVehicleAssignment is current.
    //
    // vehicle_assignments stores the registration string (not a vehicle
    // FK), so the join to fleet_vehicles is via registration. Filter by
    // is_active here too — assignments can be ended without deletion.
    const rows = await sql<{
      vehicle_id: string;
      registration: string | null;
      assigned_driver_id: string | null;
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
    }>`
      SELECT
        v.id AS vehicle_id,
        v.registration,
        v.assigned_driver_id,
        s.first_name,
        s.last_name,
        s.phone
      FROM vehicle_assignments va
      JOIN fleet_vehicles v ON v.registration = va.vehicle_registration
      JOIN staff s ON s.id = va.staff_id
      WHERE va.id = ${assignment.id}
        AND va.is_active = true
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) {
      log.error('[my/fleet-handoff] assignment row vanished mid-request', {
        assignmentId: assignment.id,
        staffId: session.staffId,
      });
      return apiResponse.notFound(res, 'Vehicle assignment', assignment.id);
    }

    const driverName = [row.first_name, row.last_name]
      .filter(Boolean)
      .join(' ')
      .trim() || null;

    const ipAddress =
      req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    const { session: portalSession, setCookieHeader } = await createPortalSession({
      vehicleId: row.vehicle_id,
      vehicleRegistration: row.registration ?? '',
      // Use the staff member's own ID as the driver attribution — that's
      // who's about to interact with the vehicle, regardless of who's
      // formally `assigned_driver_id` on the vehicle row.
      driverId: session.staffId,
      driverName,
      driverPhone: row.phone,
      source: 'my',
      confidence: 1.0,
      ipAddress,
      userAgent,
    });

    res.setHeader('Set-Cookie', setCookieHeader);

    log.info('[my/fleet-handoff] session minted', {
      sessionId: portalSession.sessionId,
      staffId: session.staffId,
      vehicleId: row.vehicle_id,
      registration: row.registration,
    });

    return apiResponse.success(res, {
      sessionId: portalSession.sessionId,
      vehicleRegistration: row.registration,
      expiresAt: portalSession.expiresAt,
    });
  } catch (error) {
    log.error('[my/fleet-handoff] failed', { error, staffId: session.staffId });
    return apiResponse.internalError(res, 'Failed to bridge to fleet portal');
  }
});

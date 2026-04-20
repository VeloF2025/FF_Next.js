/**
 * GET /api/my/attendance/current
 *
 * Returns the currently-open attendance entry for the signed-in staff
 * member, or null. Drives the portal home screen — lets the UI decide
 * whether to render "Clock In" or "Clock Out" without a round-trip
 * through the history endpoint.
 */

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { findOpenEntry } from '@/modules/attendance/portal/clockUtils';

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

export default withMySession(async (req, res, session) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const open = await findOpenEntry(session.staffId);
    if (!open) return apiResponse.success(res, { open: null });

    return apiResponse.success(res, {
      open: {
        entryId: open.id,
        workDate: open.work_date,
        clockInAt: open.clock_in_at,
        siteGeofenceId: open.site_geofence_id,
        vehicleAssignmentId: open.vehicle_assignment_id,
        selfieInUrl: open.selfie_in_url,
      },
    });
  } catch (err) {
    log.error('[my-attendance-current] unexpected error', {
      staffId: session.staffId,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  }
});

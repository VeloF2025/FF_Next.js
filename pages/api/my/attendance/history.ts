/**
 * GET /api/my/attendance/history?limit=14
 *
 * Returns the signed-in staff member's recent attendance entries,
 * most-recent first. Default 14, hard cap 60 (two-week default for the
 * portal history screen; the cap stops someone accidentally pulling
 * months of data into a phone browser).
 *
 * Sensitive fields (device_fingerprint, accuracy_m metadata, selfie URLs)
 * are included deliberately — this endpoint only ever returns the caller's
 * own rows and the /my portal uses the selfie URL to show a thumbnail
 * of "today's check-in photo."
 */

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { listRecentEntries } from '@/modules/attendance/portal/clockUtils';

const DEFAULT_LIMIT = 14;
const MAX_LIMIT = 60;

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

export default withMySession(async (req, res, session) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const limitRaw = req.query.limit;
  const limitParsed = typeof limitRaw === 'string' ? Number.parseInt(limitRaw, 10) : NaN;
  const limit = Math.min(
    Math.max(Number.isFinite(limitParsed) && limitParsed > 0 ? limitParsed : DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );

  try {
    const rows = await listRecentEntries({ staffId: session.staffId, limit });

    const entries = rows.map((r) => ({
      entryId: r.id,
      workDate: r.work_date,
      clockInAt: r.clock_in_at,
      clockOutAt: r.clock_out_at,
      status: r.status,
      siteGeofenceId: r.site_geofence_id,
      vehicleAssignmentId: r.vehicle_assignment_id,
      selfieInUrl: r.selfie_in_url,
      selfieOutUrl: r.selfie_out_url,
      durationMs:
        r.clock_out_at != null
          ? new Date(r.clock_out_at).getTime() - new Date(r.clock_in_at).getTime()
          : null,
    }));

    return apiResponse.success(res, { entries, limit });
  } catch (err) {
    log.error('[my-attendance-history] unexpected error', {
      staffId: session.staffId,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  }
});

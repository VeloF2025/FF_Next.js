/**
 * GET /api/my/fleet/incidents/{incidentId} — staff-scoped Fleet incident
 * detail (PR7 Task 4). `getDriverIncident` returns `null` both when the
 * incident does not exist and when it belongs to a different staff member
 * (design §10 IDOR safety) — both map to the same 404 here, so a response
 * never confirms another driver's incident exists.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import type { AttendanceSession } from '@/modules/attendance/portal/types';
import { getDriverIncident } from '@/modules/fleet/incidents/driver/driverIncidentService';

async function handler(req: NextApiRequest, res: NextApiResponse, session: AttendanceSession): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);

  const incidentId = req.query.incidentId;
  if (typeof incidentId !== 'string') return apiResponse.badRequest(res, 'A valid incidentId is required');

  try {
    // session.staffId — never req.query.incidentId's caller, and never a
    // body/query staffId field — is the sole scope for this read.
    const detail = await getDriverIncident(session.staffId, incidentId);
    if (!detail) return apiResponse.notFound(res, 'Incident', incidentId);
    return apiResponse.success(res, detail);
  } catch (error) {
    log.error('[my-fleet-incidents] failed to load driver incident detail', {
      staffId: session.staffId, incidentId, error: error instanceof Error ? error.message : String(error),
    }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

export default withMySession(handler);

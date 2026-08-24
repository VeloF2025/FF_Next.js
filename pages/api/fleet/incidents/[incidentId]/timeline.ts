/**
 * Scoped incident chronology (stage 8, task 6).
 *
 * Gated on the same `fleet.incidents:view` permission as the detail read this
 * timeline is rendered beside. Drivers never reach it — the `/my` portal serves
 * them their own `shared_with_driver`/`driver_submitted` view through PR7.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { IncidentNotFoundError } from '@/modules/fleet/incidents/incidentRepository';
import {
  IncidentTimelineAccessDeniedError, IncidentTimelineCursorError, TIMELINE_MAX_LIMIT, getIncidentTimeline,
} from '@/modules/fleet/incidents/analytics/timelineService';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import { isValidUUID } from '@/modules/fleet/services/mileageUtils';

interface Request extends NextApiRequest { user?: { id: string; role: string } }

/** Rejects a bad limit rather than silently clamping it — a caller that asked for 5000 rows
 * has misunderstood the endpoint, and answering 200 without saying so hides that. */
function parseLimit(raw: unknown): number | undefined | null {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') return null;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > TIMELINE_MAX_LIMIT) return null;
  return limit;
}

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  const incidentId = req.query.incidentId;
  if (typeof incidentId !== 'string' || !isValidUUID(incidentId)) {
    return apiResponse.badRequest(res, 'A valid incidentId is required');
  }
  const limit = parseLimit(req.query.limit);
  if (limit === null) return apiResponse.badRequest(res, `limit must be a whole number between 1 and ${TIMELINE_MAX_LIMIT}`);
  const cursor = req.query.cursor;
  if (cursor !== undefined && typeof cursor !== 'string') return apiResponse.badRequest(res, 'cursor must be a single value');

  try {
    const staffId = await resolveStaffIdForUser(user.id);
    const page = await getIncidentTimeline(
      incidentId, { userId: user.id, staffId, role: user.role }, { limit, cursor },
    );
    return apiResponse.success(res, page);
  } catch (error) {
    if (error instanceof IncidentNotFoundError) return apiResponse.notFound(res, 'Incident', incidentId);
    if (error instanceof IncidentTimelineAccessDeniedError) return apiResponse.forbidden(res, error.message);
    if (error instanceof IncidentTimelineCursorError) return apiResponse.badRequest(res, error.message);
    log.error('Failed to load Fleet incident timeline', { error, incidentId }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  return withPermission('fleet.incidents', 'view')(handler)(req, res);
}
export default withAuth(route);

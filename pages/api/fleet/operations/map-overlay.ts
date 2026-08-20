import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { OperationalRosterTooLargeError } from '@/modules/fleet/operations/completeRosterLoading';
import { parseStrictIsoInstant } from '@/modules/fleet/operations/instantValidation';
import { getOperationalMapOverlay, OperationalMapAccessError,
  OperationalMapRequestError } from '@/modules/fleet/operations/mapOverlayService';
import { OperationalStatusRequestError } from '@/modules/fleet/operations/statusService';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import { isValidUUID } from '@/modules/fleet/services/mileageUtils';

interface Request extends NextApiRequest { user?: { id: string; role: string } }
const stringValue = (value: string | string[] | undefined): string | undefined => typeof value === 'string' ? value : undefined;
function integer(value: string | undefined, fallback: number, max: number): number | null {
  if (value === undefined) return fallback; if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : null;
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function boolean(value: string | undefined): boolean | null {
  if (value === undefined || value === 'false') return false; if (value === 'true') return true; return null;
}

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user; if (!user) return apiResponse.unauthorized(res);
  const projectId = stringValue(req.query.projectId); const staffId = stringValue(req.query.staffId);
  const siteId = stringValue(req.query.siteId); const workDate = stringValue(req.query.workDate);
  const asOf = stringValue(req.query.asOf); const page = integer(stringValue(req.query.page), 1, Number.MAX_SAFE_INTEGER);
  const limit = integer(stringValue(req.query.limit), 25, 100); const includeGeometry = boolean(stringValue(req.query.includeGeometry));
  const uuidValues = [projectId, staffId, siteId].filter((value): value is string => value !== undefined);
  const narrow = Boolean(projectId || staffId || siteId);
  const repeatedScalar = [req.query.projectId, req.query.staffId, req.query.siteId, req.query.workDate,
    req.query.asOf, req.query.page, req.query.limit, req.query.includeGeometry].some(Array.isArray);
  if (!workDate || !validDate(workDate) || !asOf || parseStrictIsoInstant(asOf) === null || page === null
    || limit === null || includeGeometry === null || uuidValues.some((value) => !isValidUUID(value))
    || repeatedScalar || !narrow || (includeGeometry && !narrow)) {
    return apiResponse.badRequest(res, 'Valid scoped identifiers, workDate, asOf, includeGeometry, page and limit are required');
  }
  try {
    const actorStaffId = await resolveStaffIdForUser(user.id);
    const data = await getOperationalMapOverlay({ ...(projectId ? { projectId } : {}), ...(staffId ? { staffId } : {}),
      ...(siteId ? { siteId } : {}), workDate, asOf, page, limit, includeGeometry },
    { userId: user.id, staffId: actorStaffId, role: user.role });
    return apiResponse.success(res, data);
  } catch (error) {
    if (error instanceof OperationalMapAccessError) return apiResponse.forbidden(res, error.message);
    if (error instanceof OperationalRosterTooLargeError) return apiResponse.badRequest(res, error.message);
    if (error instanceof OperationalMapRequestError || error instanceof OperationalStatusRequestError) {
      return apiResponse.badRequest(res, error.message);
    }
    log.error('Failed to load operational map overlay', { error, projectId, staffId, siteId }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  return withPermission('fleet.operations-status', 'view')(handler)(req, res);
}
export default withAuth(route);

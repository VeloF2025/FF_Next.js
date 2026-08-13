import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { canAccessOperationalProject } from '@/modules/fleet/operations/projectScope';
import { getOperationalRosterStatus, OperationalStatusRequestError } from '@/modules/fleet/operations/statusService';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import { isValidUUID } from '@/modules/fleet/services/mileageUtils';

interface Request extends NextApiRequest { user?: { id: string; role: string } }
const stringValue = (value: string | string[] | undefined): string | undefined => typeof value === 'string' ? value : undefined;
const integer = (value: string | undefined, fallback: number): number | null => {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value); return Number.isSafeInteger(parsed) ? parsed : null;
};

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const projectId = stringValue(req.query.projectId); const workDate = stringValue(req.query.workDate);
  const asOf = stringValue(req.query.asOf); const page = integer(stringValue(req.query.page), 1);
  const limit = integer(stringValue(req.query.limit), 25); const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  if (!projectId || !isValidUUID(projectId) || !workDate || !asOf || page === null || limit === null) return apiResponse.badRequest(res, 'Valid projectId, workDate, asOf, page and limit are required');
  try {
    const staffId = await resolveStaffIdForUser(user.id);
    if (!await canAccessOperationalProject(user.id, staffId, user.role, projectId)) return apiResponse.forbidden(res, 'You cannot view operational status for this project');
    return apiResponse.success(res, await getOperationalRosterStatus({ projectId, workDate, asOf, page, limit }));
  } catch (error) {
    if (error instanceof OperationalStatusRequestError) return apiResponse.badRequest(res, error.message);
    log.error('Failed to load operational roster status', { error, projectId }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  return withPermission('fleet.operations-status', 'view')(handler)(req, res);
}
export default withAuth(route);

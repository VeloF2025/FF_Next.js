import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { canAccessOperationalProject, hasOperationalOversight } from '@/modules/fleet/operations/projectScope';
import { getOperationalEvidenceDetail, OperationalStatusRequestError } from '@/modules/fleet/operations/statusService';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import { isValidUUID } from '@/modules/fleet/services/mileageUtils';

interface Request extends NextApiRequest { user?: { id: string; role: string } }
const stringValue = (value: string | string[] | undefined): string | undefined => typeof value === 'string' ? value : undefined;

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const staffId = stringValue(req.query.staffId); const projectId = stringValue(req.query.projectId);
  const workDate = stringValue(req.query.workDate); const asOf = stringValue(req.query.asOf); const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  if (!staffId || !isValidUUID(staffId) || (projectId !== undefined && !isValidUUID(projectId)) || !workDate || !asOf) return apiResponse.badRequest(res, 'Valid staffId, optional projectId, workDate and asOf are required');
  try {
    const viewerStaffId = await resolveStaffIdForUser(user.id);
    const allowed = projectId ? await canAccessOperationalProject(user.id, viewerStaffId, user.role, projectId)
      : await hasOperationalOversight(user.id, user.role);
    if (!allowed) return apiResponse.forbidden(res, 'You cannot view this operational evidence');
    return apiResponse.success(res, await getOperationalEvidenceDetail({ staffId, projectId, workDate, asOf }));
  } catch (error) {
    if (error instanceof OperationalStatusRequestError) return apiResponse.badRequest(res, error.message);
    log.error('Failed to load operational evidence detail', { error, staffId, projectId }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  return withPermission('fleet.operations-status', 'view')(handler)(req, res);
}
export default withAuth(route);

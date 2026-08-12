import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { getAssignmentHistory } from '@/modules/fleet/assignments/bulkAssignmentService';
import { isValidUUID } from '@/modules/fleet/services/mileageUtils';
import { loadAssignmentProjectId } from '@/modules/fleet/assignments/assignmentQueries';
import { canEditAssignmentProject } from '@/modules/fleet/assignments/projectScope';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';

interface AssignmentRequest extends NextApiRequest { user?: { id: string; role: string } }

async function handler(req: AssignmentRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  const id = req.query.assignmentId; if (typeof id !== 'string' || !isValidUUID(id)) return apiResponse.badRequest(res, 'assignmentId must be a valid UUID');
  const user = req.user; if (!user) return apiResponse.unauthorized(res);
  const projectId = await loadAssignmentProjectId(id); if (!projectId) return apiResponse.notFound(res, 'Assignment', id);
  const staffId = await resolveStaffIdForUser(user.id);
  if (!await canEditAssignmentProject(user.id, staffId, user.role, projectId)) return apiResponse.forbidden(res, 'You cannot view this assignment');
  try { return apiResponse.success(res, await getAssignmentHistory(id)); }
  catch (error) { log.error('Assignment history failed', { error, assignmentId: id }, 'fleet'); return apiResponse.internalError(res, error); }
}
export default withAuth(withPermission('fleet.assignments', 'view')(handler));

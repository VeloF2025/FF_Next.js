import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { endAssignment, replaceAssignment, AssignmentServiceError } from '@/modules/fleet/assignments/bulkAssignmentService';
import { canEditAssignmentProject } from '@/modules/fleet/assignments/projectScope';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import { isValidUUID } from '@/modules/fleet/services/mileageUtils';
import { loadAssignmentProjectId } from '@/modules/fleet/assignments/assignmentQueries';

interface AssignmentRequest extends NextApiRequest { user?: { id: string; role: string } }
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
async function handler(req: AssignmentRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['PUT']);
  const id = req.query.assignmentId; if (typeof id !== 'string' || !isValidUUID(id)) return apiResponse.badRequest(res, 'assignmentId must be a valid UUID');
  const user = req.user; if (!user) return apiResponse.unauthorized(res);
  const body = object(req.body); if (!body) return apiResponse.badRequest(res, 'A request body is required');
  const existingProjectId = await loadAssignmentProjectId(id);
  if (!existingProjectId) return apiResponse.notFound(res, 'Assignment', id);
  const projectId = body.action === 'end' ? existingProjectId : body.projectId;
  if (typeof projectId !== 'string' || !isValidUUID(projectId)) return apiResponse.badRequest(res, 'projectId must be a valid UUID');
  const staffId = await resolveStaffIdForUser(user.id);
  if (!await canEditAssignmentProject(user.id, staffId, user.role, existingProjectId)
    || !await canEditAssignmentProject(user.id, staffId, user.role, projectId)) return apiResponse.forbidden(res, 'You cannot edit this project');
  const actor = { userId: user.id, staffId: staffId ?? undefined, role: user.role };
  try {
    const result = body.action === 'end'
      ? await endAssignment(id, { endDate: String(body.endDate ?? ''), reason: String(body.reason ?? '') }, actor)
      : await replaceAssignment(id, body, actor);
    return apiResponse.success(res, result);
  } catch (error) {
    if (error instanceof AssignmentServiceError) {
      if (error.status === 404) return apiResponse.notFound(res, 'Assignment', id);
      if (error.status === 409) return apiResponse.conflict(res, error.message, { code: error.code });
      return apiResponse.badRequest(res, error.message, { code: error.code });
    }
    log.error('Assignment update failed', { error, assignmentId: id }, 'fleet'); return apiResponse.internalError(res, error);
  }
}
export default withAuth(withPermission('fleet.assignments', 'edit')(handler));

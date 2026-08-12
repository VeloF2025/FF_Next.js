import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { previewAssignmentCopy, AssignmentServiceError } from '@/modules/fleet/assignments/bulkAssignmentService';
import { loadAssignmentsForCopy } from '@/modules/fleet/assignments/assignmentQueries';
import { canEditAssignmentProject } from '@/modules/fleet/assignments/projectScope';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';

interface AssignmentRequest extends NextApiRequest { user?: { id: string; role: string } }
async function handler(req: AssignmentRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  const body = req.body as Record<string, unknown> | null;
  if (!body || !Array.isArray(body.assignmentIds) || body.assignmentIds.some((id) => typeof id !== 'string') || typeof body.destinationStartDate !== 'string') return apiResponse.badRequest(res, 'assignmentIds and destinationStartDate are required');
  const user = req.user; if (!user) return apiResponse.unauthorized(res);
  const source = await loadAssignmentsForCopy(body.assignmentIds as string[]);
  const projectIds = [...new Set(source.map((row) => row.projectId))];
  const staffId = await resolveStaffIdForUser(user.id);
  for (const projectId of projectIds) if (!await canEditAssignmentProject(user.id, staffId, user.role, projectId)) return apiResponse.forbidden(res, 'You cannot edit one or more selected projects');
  try {
    return apiResponse.success(res, await previewAssignmentCopy({ assignmentIds: body.assignmentIds as string[], destinationStartDate: body.destinationStartDate }, { authorizedProjectIds: projectIds }));
  } catch (error) {
    if (error instanceof AssignmentServiceError) return error.status === 409 ? apiResponse.conflict(res, error.message, { code: error.code }) : apiResponse.badRequest(res, error.message, { code: error.code });
    log.error('Assignment copy preview failed', { error }, 'fleet'); return apiResponse.internalError(res, error);
  }
}
export default withAuth(withPermission('fleet.assignments', 'edit')(handler));

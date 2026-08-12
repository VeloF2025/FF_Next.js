import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { previewAssignments, AssignmentServiceError, type PreviewAssignmentsInput } from '@/modules/fleet/assignments/bulkAssignmentService';
import { canEditAssignmentProject } from '@/modules/fleet/assignments/projectScope';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';

interface AssignmentRequest extends NextApiRequest { user?: { id: string; role: string } }
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

async function handler(req: AssignmentRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  const user = req.user; if (!user) return apiResponse.unauthorized(res);
  const body = record(req.body);
  if (!body || !Array.isArray(body.rows)) return apiResponse.badRequest(res, 'rows must be an array');
  const input = body as unknown as PreviewAssignmentsInput;
  const projectIds = [...new Set(input.rows.map((row) => record(row)?.projectId).filter((id): id is string => typeof id === 'string'))];
  const teamProject = record(input.teamRow)?.projectId;
  if (typeof teamProject === 'string') projectIds.push(teamProject);
  const staffId = await resolveStaffIdForUser(user.id);
  for (const projectId of new Set(projectIds)) {
    if (!await canEditAssignmentProject(user.id, staffId, user.role, projectId)) return apiResponse.forbidden(res, 'You cannot edit one or more selected projects');
  }
  try {
    return apiResponse.success(res, await previewAssignments(input, { authorizedProjectIds: [...new Set(projectIds)] }));
  } catch (error) {
    if (error instanceof AssignmentServiceError) {
      if (error.status === 404) return apiResponse.notFound(res, 'Assignment');
      return error.status === 409 ? apiResponse.conflict(res, error.message, { code: error.code }) : apiResponse.badRequest(res, error.message, { code: error.code });
    }
    log.error('Assignment preview failed', { error }, 'fleet'); return apiResponse.internalError(res, error);
  }
}
export default withAuth(withPermission('fleet.assignments', 'edit')(handler));

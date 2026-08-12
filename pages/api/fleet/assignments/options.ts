import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { query } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { canViewAssignmentProject } from '@/modules/fleet/assignments/projectScope';
import { listAssignmentOptions } from '@/modules/fleet/assignments/rosterQueries';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import { isValidUUID } from '@/modules/fleet/services/mileageUtils';

interface AssignmentRequest extends NextApiRequest {
  user?: { id: string; role: string };
}

interface ProjectRow extends Record<string, unknown> {
  id: string;
}

function selectedProjectId(value: string | string[] | undefined): string | string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !isValidUUID(value)) return 'projectId must be a valid UUID';
  return value;
}

async function routeHandler(req: AssignmentRequest, res: NextApiResponse) {
  const projectId = selectedProjectId(req.query.projectId);
  if (projectId === 'projectId must be a valid UUID') return apiResponse.badRequest(res, projectId);
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);

  try {
    const staffId = await resolveStaffIdForUser(user.id);
    const projects = await query<ProjectRow>(`
      SELECT id
      FROM projects
      WHERE status = 'active'
      ORDER BY project_name ASC`);
    const authorizedProjectIds = (await Promise.all(projects.map(async (project) => (
      await canViewAssignmentProject(user.id, staffId, user.role, project.id) ? project.id : null
    )))).filter((id): id is string => id !== null);

    return apiResponse.success(res, await listAssignmentOptions(
      projectId ? { projectId } : {},
      authorizedProjectIds,
    ));
  } catch (error) {
    log.error('Failed to load fleet assignment options', { error, projectId }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function permissionRouted(req: AssignmentRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  return withPermission('fleet.assignments', 'view')(routeHandler)(req, res);
}

export default withAuth(permissionRouted);

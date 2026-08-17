import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import {
  ProjectSiteValidationError,
  updateProjectSite,
  type UpdateProjectSiteInput,
} from '@/modules/fleet/assignments/projectSiteQueries';
import { canEditAssignmentProject } from '@/modules/fleet/assignments/projectScope';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import { isValidUUID } from '@/modules/fleet/services/mileageUtils';

interface AssignmentRequest extends NextApiRequest {
  user?: { id: string; role: string };
}

function bodyRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseUpdateBody(value: unknown): UpdateProjectSiteInput | string {
  const body = bodyRecord(value);
  if (typeof body.projectId !== 'string' || !isValidUUID(body.projectId)) {
    return 'projectId must be a valid UUID';
  }
  if (body.displayName !== undefined
    && (typeof body.displayName !== 'string'
      || body.displayName.trim().length === 0
      || body.displayName.trim().length > 200)) {
    return 'displayName must be between 1 and 200 characters';
  }
  if (body.isDefault !== undefined && typeof body.isDefault !== 'boolean') {
    return 'isDefault must be a boolean';
  }
  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
    return 'isActive must be a boolean';
  }
  if (body.displayName === undefined && body.isDefault === undefined && body.isActive === undefined) {
    return 'At least one editable site field is required';
  }
  return {
    projectId: body.projectId,
    displayName: typeof body.displayName === 'string' ? body.displayName.trim() : undefined,
    isDefault: typeof body.isDefault === 'boolean' ? body.isDefault : undefined,
    isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
  };
}

function databaseCode(error: unknown): string | null {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

async function routeHandler(req: AssignmentRequest, res: NextApiResponse) {
  const siteId = req.query.siteId;
  if (typeof siteId !== 'string' || !isValidUUID(siteId)) {
    return apiResponse.badRequest(res, 'siteId must be a valid UUID');
  }
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  const input = parseUpdateBody(req.body);
  if (typeof input === 'string') return apiResponse.badRequest(res, input);

  const staffId = await resolveStaffIdForUser(user.id);
  if (!await canEditAssignmentProject(user.id, staffId, user.role, input.projectId!)) {
    return apiResponse.forbidden(res, 'You cannot configure sites for this project');
  }

  try {
    const updated = await updateProjectSite(siteId, input, { userId: user.id });
    if (!updated) return apiResponse.notFound(res, 'Project operational site', siteId);
    return apiResponse.success(res, updated, 'Project operational site updated');
  } catch (error) {
    if (error instanceof ProjectSiteValidationError) {
      return apiResponse.badRequest(res, error.message, { code: error.code });
    }
    if (databaseCode(error) === '23505') {
      return apiResponse.conflict(res, 'Another active default or duplicate site mapping exists');
    }
    log.error('Failed to update project operational site', { error, siteId }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function permissionRouted(req: AssignmentRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['PUT']);
  }
  return withPermission('fleet.assignments', 'edit')(routeHandler)(req, res);
}

export default withAuth(permissionRouted);

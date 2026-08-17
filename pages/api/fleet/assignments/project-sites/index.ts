import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import {
  ProjectSiteValidationError,
  createProjectSite,
  listProjectSites,
  type CreateProjectSiteInput,
} from '@/modules/fleet/assignments/projectSiteQueries';
import {
  canEditAssignmentProject,
  canViewAssignmentProject,
} from '@/modules/fleet/assignments/projectScope';
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

function optionalUuid(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !isValidUUID(value)) return undefined;
  return value;
}

function parseCreateBody(value: unknown): CreateProjectSiteInput | string {
  const body = bodyRecord(value);
  if (typeof body.projectId !== 'string' || !isValidUUID(body.projectId)) {
    return 'projectId must be a valid UUID';
  }
  const projectAoiId = optionalUuid(body.projectAoiId);
  const authorizedLocationId = optionalUuid(body.authorizedLocationId);
  if (projectAoiId === undefined || authorizedLocationId === undefined) {
    return 'Site source IDs must be valid UUIDs';
  }
  if (Number(Boolean(projectAoiId)) + Number(Boolean(authorizedLocationId)) !== 1) {
    return 'Exactly one of projectAoiId and authorizedLocationId is required';
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
  return {
    projectId: body.projectId,
    displayName: typeof body.displayName === 'string' ? body.displayName.trim() : undefined,
    projectAoiId,
    authorizedLocationId,
    isDefault: body.isDefault === true,
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
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);

  if (req.method === 'GET') {
    const projectId = req.query.projectId;
    if (typeof projectId !== 'string' || !isValidUUID(projectId)) {
      return apiResponse.badRequest(res, 'projectId must be a valid UUID');
    }
    const inactiveFlag = req.query.includeInactive;
    if (inactiveFlag !== undefined && inactiveFlag !== 'true' && inactiveFlag !== 'false') {
      return apiResponse.badRequest(res, 'includeInactive must be true or false');
    }

    // The module-level `fleet.assignments:view` grant is broad (migration 497
    // gives it to manager and viewer), so without this any grant holder could
    // enumerate any active project's site configuration. Every other read in
    // this module re-checks per-project scope; this one did not.
    const staffId = await resolveStaffIdForUser(user.id);
    if (!await canViewAssignmentProject(user.id, staffId, user.role, projectId)) {
      return apiResponse.forbidden(res, 'You cannot view sites for this project');
    }

    try {
      return apiResponse.success(res, await listProjectSites(projectId, inactiveFlag === 'true'));
    } catch (error) {
      log.error('Failed to list project operational sites', { error, projectId }, 'fleet');
      return apiResponse.internalError(res, error);
    }
  }

  const input = parseCreateBody(req.body);
  if (typeof input === 'string') return apiResponse.badRequest(res, input);

  const staffId = await resolveStaffIdForUser(user.id);
  if (!await canEditAssignmentProject(user.id, staffId, user.role, input.projectId)) {
    return apiResponse.forbidden(res, 'You cannot configure sites for this project');
  }

  try {
    const site = await createProjectSite(input, { userId: user.id });
    return apiResponse.created(res, site, 'Project operational site created');
  } catch (error) {
    if (error instanceof ProjectSiteValidationError) {
      return apiResponse.badRequest(res, error.message, { code: error.code });
    }
    if (databaseCode(error) === '23505') {
      return apiResponse.conflict(res, 'That active project site mapping already exists');
    }
    log.error('Failed to create project operational site', {
      error,
      projectId: input.projectId,
    }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function permissionRouted(req: AssignmentRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
  }
  const action = req.method === 'GET' ? 'view' : 'edit';
  return withPermission('fleet.assignments', action)(routeHandler)(req, res);
}

export default withAuth(permissionRouted);

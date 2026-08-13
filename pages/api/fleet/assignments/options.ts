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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DATE_SPAN_DAYS = 366;

function stringQuery(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function validIsoDate(value: string | undefined): boolean {
  if (!value || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function selectedDateRange(query: NextApiRequest['query']): { startDate?: string; endDate?: string } | string {
  const startDate = stringQuery(query.from);
  const endDate = stringQuery(query.to);
  if (startDate !== undefined && !validIsoDate(startDate)) return 'from must be a valid ISO date';
  if (endDate !== undefined && !validIsoDate(endDate)) return 'to must be a valid ISO date';
  if (startDate && endDate) {
    const span = (Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / 86_400_000;
    if (span < 0 || span > MAX_DATE_SPAN_DAYS) return 'Date range must be between 0 and 366 days';
  }
  return {
    ...((startDate || endDate) ? { startDate: startDate ?? endDate, endDate: endDate ?? startDate } : {}),
  };
}

function selectedProjectId(value: string | string[] | undefined): string | string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !isValidUUID(value)) return 'projectId must be a valid UUID';
  return value;
}

async function routeHandler(req: AssignmentRequest, res: NextApiResponse) {
  const projectId = selectedProjectId(req.query.projectId);
  if (projectId === 'projectId must be a valid UUID') return apiResponse.badRequest(res, projectId);
  const dateRange = selectedDateRange(req.query);
  if (typeof dateRange === 'string') return apiResponse.badRequest(res, dateRange);
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
      { ...(projectId ? { projectId } : {}), ...dateRange },
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

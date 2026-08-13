import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { canViewAssignmentProject } from '@/modules/fleet/assignments/projectScope';
import { listAssignmentRoster, type AssignmentRosterFilters } from '@/modules/fleet/assignments/rosterQueries';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import { isValidUUID } from '@/modules/fleet/services/mileageUtils';

interface AssignmentRequest extends NextApiRequest {
  user?: { id: string; role: string };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DATE_SPAN_DAYS = 366;

function stringQuery(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function positiveInteger(value: string | undefined, name: string, maximum: number): number | string | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return `${name} must be a positive integer`;
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue < 1 || numberValue > maximum) {
    return `${name} must be between 1 and ${maximum}`;
  }
  return numberValue;
}

function validIsoDate(value: string | undefined): boolean {
  if (!value || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseFilters(query: NextApiRequest['query']): AssignmentRosterFilters | string {
  const projectId = stringQuery(query.projectId);
  const staffId = stringQuery(query.staffId);
  const siteId = stringQuery(query.siteId);
  const from = stringQuery(query.from);
  const to = stringQuery(query.to);
  const source = stringQuery(query.source);
  const page = positiveInteger(stringQuery(query.page), 'page', 100000);
  const limit = positiveInteger(stringQuery(query.limit), 'limit', 100);

  if (!projectId || !isValidUUID(projectId)) return 'projectId must be a valid UUID';
  if (staffId !== undefined && !isValidUUID(staffId)) return 'staffId must be a valid UUID';
  if (siteId !== undefined && !isValidUUID(siteId)) return 'siteId must be a valid UUID';
  if (from !== undefined && !validIsoDate(from)) return 'from must be a valid ISO date';
  if (to !== undefined && !validIsoDate(to)) return 'to must be a valid ISO date';
  if (source !== undefined && source !== 'roster' && source !== 'daily_override') {
    return 'source must be roster or daily_override';
  }
  if (typeof page === 'string') return page;
  if (typeof limit === 'string') return limit;
  if (from && to) {
    const span = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000;
    if (span < 0 || span > MAX_DATE_SPAN_DAYS) return 'Date range must be between 0 and 366 days';
  }

  const requestedLimit = limit ?? 25;
  return {
    projectId,
    staffId,
    siteId,
    source,
    startDate: from,
    endDate: to,
    limit: requestedLimit,
    offset: ((page ?? 1) - 1) * requestedLimit,
  };
}

async function routeHandler(req: AssignmentRequest, res: NextApiResponse) {
  const filters = parseFilters(req.query);
  if (typeof filters === 'string') return apiResponse.badRequest(res, filters);
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);

  try {
    const staffId = await resolveStaffIdForUser(user.id);
    if (!await canViewAssignmentProject(user.id, staffId, user.role, filters.projectId!)) {
      return apiResponse.forbidden(res, 'You cannot view assignments for this project');
    }
    return apiResponse.success(res, await listAssignmentRoster(filters));
  } catch (error) {
    log.error('Failed to list fleet assignments', { error, projectId: filters.projectId }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function permissionRouted(req: AssignmentRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  return withPermission('fleet.assignments', 'view')(routeHandler)(req, res);
}

export default withAuth(permissionRouted);

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { buildOperationalOverview } from '@/modules/fleet/operations/overviewService';
import { parseStrictIsoInstant } from '@/modules/fleet/operations/instantValidation';
import { canAccessOperationalProject } from '@/modules/fleet/operations/projectScope';
import { getOperationalRosterStatus, OperationalStatusRequestError } from '@/modules/fleet/operations/statusService';
import type { OperationalStatus } from '@/modules/fleet/operations/types';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import { isValidUUID } from '@/modules/fleet/services/mileageUtils';

interface Request extends NextApiRequest { user?: { id: string; role: string } }
const STATUSES: OperationalStatus[] = ['off_duty', 'scheduled_not_due', 'unassigned', 'unverifiable', 'late',
  'approaching', 'attendance_confirmed', 'vehicle_on_site_driver_unconfirmed', 'on_site_dual', 'wrong_site',
  'evidence_mismatch', 'left_early', 'shift_complete'];
const GROUPS: Record<string, OperationalStatus[]> = {
  on_site: ['on_site_dual', 'attendance_confirmed'], approaching: ['approaching'], late: ['late'],
  wrong_site: ['wrong_site'], mismatch: ['evidence_mismatch'], left_early: ['left_early'],
  unassigned: ['unassigned'], unverifiable: ['unverifiable', 'vehicle_on_site_driver_unconfirmed'],
  normal: ['off_duty', 'scheduled_not_due', 'shift_complete'],
};
const stringValue = (value: string | string[] | undefined): string | undefined => typeof value === 'string' ? value : undefined;
function integer(value: string | undefined, fallback: number, max: number): number | null {
  if (value === undefined) return fallback; if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : null;
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user; if (!user) return apiResponse.unauthorized(res);
  const projectId = stringValue(req.query.projectId); const workDate = stringValue(req.query.workDate);
  const asOf = stringValue(req.query.asOf); const page = integer(stringValue(req.query.page), 1, Number.MAX_SAFE_INTEGER);
  const limit = integer(stringValue(req.query.limit), 25, 100); const status = stringValue(req.query.status);
  const group = stringValue(req.query.group);
  const repeatedFilter = [req.query.page, req.query.limit, req.query.status, req.query.group].some(Array.isArray);
  const competingFilters = req.query.status !== undefined && req.query.group !== undefined;
  const statusFilter = status && STATUSES.includes(status as OperationalStatus) ? [status as OperationalStatus]
    : group && GROUPS[group] ? GROUPS[group] : status || group ? null : undefined;
  if (!projectId || !isValidUUID(projectId) || !workDate || !validDate(workDate) || !asOf
    || parseStrictIsoInstant(asOf) === null || page === null || limit === null || statusFilter === null
    || repeatedFilter || competingFilters
    || req.query.includeGeometry !== undefined) {
    return apiResponse.badRequest(res, 'Valid projectId, workDate, asOf, filters, page and limit are required');
  }
  try {
    const staffId = await resolveStaffIdForUser(user.id);
    if (!await canAccessOperationalProject(user.id, staffId, user.role, projectId)) {
      return apiResponse.forbidden(res, 'You cannot view operational status for this project');
    }
    const roster = await getOperationalRosterStatus({ projectId, workDate, asOf, page: 1, limit: 100 });
    const overview = buildOperationalOverview(roster, { page, limit, ...(statusFilter ? { attentionStatuses: statusFilter } : {}) });
    const first = roster.items[0];
    return apiResponse.success(res, { ...overview, workDate, evaluatedAt: asOf,
      rule: { id: first?.ruleId ?? null, version: first?.ruleVersion ?? null } });
  } catch (error) {
    if (error instanceof OperationalStatusRequestError) return apiResponse.badRequest(res, error.message);
    log.error('Failed to load operational overview', { error, projectId }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  return withPermission('fleet.operations-status', 'view')(handler)(req, res);
}
export default withAuth(route);

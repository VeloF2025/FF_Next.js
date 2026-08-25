import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { parseStrictIsoInstant } from '@/modules/fleet/operations/instantValidation';
import type { CreateVehicleRuleVersionInput, VehicleRuleThresholdKey } from '@/modules/fleet/vehicleDetectors/types';
import {
  VehicleRuleValidationError,
  createVehicleRuleVersion,
  listVehicleRuleVersions,
} from '@/modules/fleet/vehicleDetectors/vehicleRuleQueries';

interface Request extends NextApiRequest { user?: { id: string; role: string } }

const NUMERIC_FIELDS: VehicleRuleThresholdKey[] = [
  'theftDisplacementMeters', 'theftMinPositions', 'harshLinearG', 'harshLateralG',
  'harshMinSpeedKph', 'speedOverLimitKph', 'unauthorizedStopMinutes',
  'lostContactMinutes', 'idleAlertMinutes', 'knownSiteRadiusMeters',
];
const CLOCK_TIME = /^\d{2}:\d{2}(:\d{2})?$/;

/**
 * Shape-check only. The thresholds' own bounds are `vehicleRuleQueries`'
 * business, and the database's after that — duplicating them here would give
 * the rule two homes that can drift.
 */
function parseInput(body: unknown): CreateVehicleRuleVersionInput | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (value.timezone !== 'Africa/Johannesburg') return null;
  if (typeof value.effectiveFrom !== 'string' || parseStrictIsoInstant(value.effectiveFrom) === null) return null;
  if (typeof value.changeReason !== 'string' || !value.changeReason.trim()) return null;
  if (typeof value.afterHoursStartTime !== 'string' || !CLOCK_TIME.test(value.afterHoursStartTime)) return null;
  if (typeof value.afterHoursEndTime !== 'string' || !CLOCK_TIME.test(value.afterHoursEndTime)) return null;
  if (typeof value.weekendsAreAfterHours !== 'boolean' || typeof value.publicHolidaysAreAfterHours !== 'boolean') return null;
  if (NUMERIC_FIELDS.some((field) => typeof value[field] !== 'number' || !Number.isFinite(value[field] as number))) return null;
  const thresholds = Object.fromEntries(
    NUMERIC_FIELDS.map((field) => [field, value[field] as number]),
  ) as Record<VehicleRuleThresholdKey, number>;
  return {
    ...thresholds,
    timezone: value.timezone,
    effectiveFrom: value.effectiveFrom,
    afterHoursStartTime: value.afterHoursStartTime,
    afterHoursEndTime: value.afterHoursEndTime,
    weekendsAreAfterHours: value.weekendsAreAfterHours,
    publicHolidaysAreAfterHours: value.publicHolidaysAreAfterHours,
    changeReason: value.changeReason.trim(),
  };
}

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  try {
    if (req.method === 'GET') return apiResponse.success(res, await listVehicleRuleVersions());
    const input = parseInput(req.body);
    if (!input) return apiResponse.badRequest(res, 'All vehicle rule fields and a change reason are required');
    // The actor is the session, never the body: a client-supplied actorUserId
    // would let a caller attribute a threshold change to someone else.
    return apiResponse.created(res, await createVehicleRuleVersion(input, user.id));
  } catch (error) {
    if (error instanceof VehicleRuleValidationError) return apiResponse.badRequest(res, error.message);
    log.error('Failed to manage vehicle operational rules', { error, method: req.method }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
  }
  const action = req.method === 'POST' ? 'edit' : 'view';
  return withPermission('fleet.vehicle-rules', action)(handler)(req, res);
}

export default withAuth(route);

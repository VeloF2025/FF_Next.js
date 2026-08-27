import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { parseStrictIsoInstant } from '@/modules/fleet/operations/instantValidation';
import {
  VEHICLE_RULE_TIMEZONE,
  type CreateVehicleRuleVersionInput,
  type VehicleRuleThresholdKey,
} from '@/modules/fleet/vehicleDetectors/types';
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

/** Either a parsed input, or the specific reason it was refused. */
type ParseResult =
  | { ok: true; input: CreateVehicleRuleVersionInput }
  | { ok: false; message: string };

/**
 * Shape-check only. The thresholds' own bounds are `vehicleRuleQueries`'
 * business, and the database's after that — duplicating them here would give
 * the rule two homes that can drift.
 */
function parseInput(body: unknown): ParseResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'A vehicle rule version object is required' };
  }
  const value = body as Record<string, unknown>;
  // Compared against the constant migration 529 seeds version 1 with, not a
  // literal typed twice: a second timezone would silently split the fleet
  // across two after-hours calendars.
  if (value.timezone !== VEHICLE_RULE_TIMEZONE) {
    return { ok: false, message: `timezone must be ${VEHICLE_RULE_TIMEZONE}` };
  }
  if (typeof value.effectiveFrom !== 'string' || parseStrictIsoInstant(value.effectiveFrom) === null) {
    return { ok: false, message: 'effectiveFrom must be a valid ISO instant' };
  }
  if (typeof value.changeReason !== 'string' || !value.changeReason.trim()) {
    return { ok: false, message: 'changeReason is required' };
  }
  if (typeof value.afterHoursStartTime !== 'string' || !CLOCK_TIME.test(value.afterHoursStartTime)
    || typeof value.afterHoursEndTime !== 'string' || !CLOCK_TIME.test(value.afterHoursEndTime)) {
    return { ok: false, message: 'After-hours times must be HH:MM or HH:MM:SS' };
  }
  if (typeof value.weekendsAreAfterHours !== 'boolean' || typeof value.publicHolidaysAreAfterHours !== 'boolean') {
    return { ok: false, message: 'weekendsAreAfterHours and publicHolidaysAreAfterHours must be booleans' };
  }
  const missing = NUMERIC_FIELDS.filter(
    (field) => typeof value[field] !== 'number' || !Number.isFinite(value[field] as number),
  );
  if (missing.length > 0) {
    return { ok: false, message: `These thresholds must be finite numbers: ${missing.join(', ')}` };
  }
  const thresholds = Object.fromEntries(
    NUMERIC_FIELDS.map((field) => [field, value[field] as number]),
  ) as Record<VehicleRuleThresholdKey, number>;
  return {
    ok: true,
    input: {
      ...thresholds,
      timezone: VEHICLE_RULE_TIMEZONE,
      effectiveFrom: value.effectiveFrom,
      afterHoursStartTime: value.afterHoursStartTime,
      afterHoursEndTime: value.afterHoursEndTime,
      weekendsAreAfterHours: value.weekendsAreAfterHours,
      publicHolidaysAreAfterHours: value.publicHolidaysAreAfterHours,
      changeReason: value.changeReason.trim(),
    },
  };
}

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  try {
    if (req.method === 'GET') return apiResponse.success(res, await listVehicleRuleVersions());
    const parsed = parseInput(req.body);
    if (!parsed.ok) return apiResponse.badRequest(res, parsed.message);
    // The actor is the session, never the body: a client-supplied actorUserId
    // would let a caller attribute a threshold change to someone else.
    return apiResponse.created(res, await createVehicleRuleVersion(parsed.input, user.id));
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
  // 'create', not 'edit': a POST authors a NEW version and never mutates an
  // existing row. Rule history is append-only by design, and the role grants in
  // 529 say create and edit separately so the two can diverge later.
  const action = req.method === 'POST' ? 'create' : 'view';
  return withPermission('fleet.vehicle-rules', action)(handler)(req, res);
}

export default withAuth(route);

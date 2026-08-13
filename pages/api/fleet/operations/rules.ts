import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { hasOperationalOversight } from '@/modules/fleet/operations/projectScope';
import { parseStrictIsoInstant } from '@/modules/fleet/operations/instantValidation';
import { createRuleVersion, listRuleVersions, RuleValidationError, type CreateRuleVersionInput } from '@/modules/fleet/operations/ruleQueries';

interface Request extends NextApiRequest { user?: { id: string; role: string } }
const numericFields: Array<keyof CreateRuleVersionInput> = [
  'monitoringBeforeMinutes', 'monitoringAfterMinutes', 'arrivalDwellMinutes',
  'wrongSiteConfirmationMinutes', 'earlyDepartureConfirmationMinutes', 'approachingDistanceMeters',
  'approachingMinReadings', 'minimumMovingSpeedKmh', 'evidenceMismatchToleranceMeters',
];

function parseInput(body: unknown): CreateRuleVersionInput | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (value.timezone !== 'Africa/Johannesburg' || typeof value.effectiveFrom !== 'string'
    || parseStrictIsoInstant(value.effectiveFrom) === null || typeof value.changeReason !== 'string'
    || !value.changeReason.trim() || numericFields.some((field) => typeof value[field] !== 'number')) return null;
  return {
    timezone: value.timezone, effectiveFrom: value.effectiveFrom,
    monitoringBeforeMinutes: value.monitoringBeforeMinutes as number,
    monitoringAfterMinutes: value.monitoringAfterMinutes as number,
    arrivalDwellMinutes: value.arrivalDwellMinutes as number,
    wrongSiteConfirmationMinutes: value.wrongSiteConfirmationMinutes as number,
    earlyDepartureConfirmationMinutes: value.earlyDepartureConfirmationMinutes as number,
    approachingDistanceMeters: value.approachingDistanceMeters as number,
    approachingMinReadings: value.approachingMinReadings as number,
    minimumMovingSpeedKmh: value.minimumMovingSpeedKmh as number,
    evidenceMismatchToleranceMeters: value.evidenceMismatchToleranceMeters as number,
    changeReason: value.changeReason.trim(),
  };
}

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user; if (!user) return apiResponse.unauthorized(res);
  const action = req.method === 'POST' ? 'edit' : 'view';
  try {
    if (req.method === 'POST' && !await hasOperationalOversight(user.id, user.role, 'fleet.operations-rules', action)) return apiResponse.forbidden(res, 'Operational rule oversight is required');
    if (req.method === 'GET') return apiResponse.success(res, await listRuleVersions());
    const input = parseInput(req.body); if (!input) return apiResponse.badRequest(res, 'All rule fields and a change reason are required');
    return apiResponse.created(res, await createRuleVersion(input, user.id));
  } catch (error) {
    if (error instanceof RuleValidationError) return apiResponse.badRequest(res, error.message);
    log.error('Failed to manage operational rules', { error, method: req.method }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
  const action = req.method === 'POST' ? 'edit' : 'view';
  return withPermission('fleet.operations-rules', action)(handler)(req, res);
}
export default withAuth(route);

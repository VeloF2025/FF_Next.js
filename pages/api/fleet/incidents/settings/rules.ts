import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { INCIDENT_TYPES, IncidentValidationError } from '@/modules/fleet/incidents/reviewValidation';
import { parseRuleChangeBody } from '@/modules/fleet/incidents/incidentSettingsValidation';
import { IncidentSettingsValidationError, listIncidentRuleVersions, versionIncidentRule } from '@/modules/fleet/incidents/settingsRepository';
import type { IncidentType } from '@/modules/fleet/incidents/types';

interface Request extends NextApiRequest { user?: { id: string; role: string } }

function parseIncidentType(value: string | string[] | undefined): IncidentType | null {
  if (typeof value !== 'string' || !INCIDENT_TYPES.includes(value as IncidentType)) return null;
  return value as IncidentType;
}

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  try {
    if (req.method === 'GET') {
      const incidentType = parseIncidentType(req.query.incidentType);
      if (!incidentType) return apiResponse.badRequest(res, 'A valid incidentType is required');
      return apiResponse.success(res, await listIncidentRuleVersions(incidentType));
    }
    const body = parseRuleChangeBody(req.body);
    // The session actor is always used — never any actorUserId in the request body.
    const created = await versionIncidentRule({ ...body, actorUserId: user.id });
    return apiResponse.created(res, created);
  } catch (error) {
    if (error instanceof IncidentValidationError || error instanceof IncidentSettingsValidationError) return apiResponse.badRequest(res, error.message);
    log.error('Failed to manage Fleet incident rules', { error, method: req.method }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
  const action = req.method === 'POST' ? 'edit' : 'view';
  return withPermission('fleet.incidents-settings', action)(handler)(req, res);
}
export default withAuth(route);

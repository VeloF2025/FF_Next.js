import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import {
  DriverInputSettingsValidationError, getEffectiveDriverInputSettings, versionDriverInputSettings,
  type DriverInputSettingsChangeRequest,
} from '@/modules/fleet/incidents/driver/settingsRepository';

interface Request extends NextApiRequest { user?: { id: string; role: string } }

function parseChannels(value: unknown, field: string): { inApp: boolean; email: boolean; whatsapp: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DriverInputSettingsValidationError(`${field} must be an object`);
  const record = value as Record<string, unknown>;
  const { inApp, email, whatsapp } = record;
  if (typeof inApp !== 'boolean' || typeof email !== 'boolean' || typeof whatsapp !== 'boolean') {
    throw new DriverInputSettingsValidationError(`${field} must have boolean inApp, email, and whatsapp fields`);
  }
  return { inApp, email, whatsapp };
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new DriverInputSettingsValidationError(`${field} must be an array of strings`);
  }
  return value as string[];
}

function parseNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new DriverInputSettingsValidationError(`${field} must be a number`);
  return value;
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new DriverInputSettingsValidationError(`${field} must be a boolean`);
  return value;
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new DriverInputSettingsValidationError(`${field} is required`);
  return value;
}

/**
 * Type-shape validation only. Semantic validation (positive integers, category
 * membership, MIME-signature coverage, effectiveFrom ordering, ...) lives in
 * `versionDriverInputSettings` itself, so this route and any future non-HTTP
 * caller share one rule set — mirrors `settings/rules.ts`'s `parseRuleChangeBody`.
 */
function parseDriverInputSettingsBody(body: unknown): DriverInputSettingsChangeRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DriverInputSettingsValidationError('Request body is required');
  const value = body as Record<string, unknown>;

  const changeReason = value.changeReason;
  if (changeReason !== undefined && changeReason !== null && typeof changeReason !== 'string') {
    throw new DriverInputSettingsValidationError('changeReason must be a string');
  }

  return {
    responseWindowWorkdays: parseNumber(value.responseWindowWorkdays, 'responseWindowWorkdays'),
    postClosureResponseEnabled: parseBoolean(value.postClosureResponseEnabled, 'postClosureResponseEnabled'),
    postClosureResponseWindowDays: parseNumber(value.postClosureResponseWindowDays, 'postClosureResponseWindowDays'),
    recentWindowDays: parseNumber(value.recentWindowDays, 'recentWindowDays'),
    historyWindowDays: parseNumber(value.historyWindowDays, 'historyWindowDays'),
    enabledConcernCategories: parseStringArray(value.enabledConcernCategories, 'enabledConcernCategories') as DriverInputSettingsChangeRequest['enabledConcernCategories'],
    evidenceAllowedMimeTypes: parseStringArray(value.evidenceAllowedMimeTypes, 'evidenceAllowedMimeTypes'),
    evidenceMaxBytes: parseNumber(value.evidenceMaxBytes, 'evidenceMaxBytes'),
    driverInputRequestedChannels: parseChannels(value.driverInputRequestedChannels, 'driverInputRequestedChannels'),
    driverResponseReceivedChannels: parseChannels(value.driverResponseReceivedChannels, 'driverResponseReceivedChannels'),
    effectiveFrom: parseString(value.effectiveFrom, 'effectiveFrom'),
    changeReason: (changeReason as string | null | undefined) ?? null,
  };
}

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  try {
    if (req.method === 'GET') {
      return apiResponse.success(res, await getEffectiveDriverInputSettings(new Date().toISOString()));
    }
    const body = parseDriverInputSettingsBody(req.body);
    // The session actor is always used — never any actorUserId in the request body.
    const created = await versionDriverInputSettings(body, user.id);
    return apiResponse.created(res, created);
  } catch (error) {
    if (error instanceof DriverInputSettingsValidationError) return apiResponse.badRequest(res, error.message);
    log.error('Failed to manage Fleet driver-input settings', { error, method: req.method }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
  const action = req.method === 'POST' ? 'edit' : 'view';
  return withPermission('fleet.incidents-settings', action)(handler)(req, res);
}
export default withAuth(route);

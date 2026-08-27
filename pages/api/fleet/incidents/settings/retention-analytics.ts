/**
 * The PR8 analytics/retention policy: read it, or open the next version of it
 * (stage 8, task 9b).
 *
 * Reading and writing are gated differently and deliberately. A project
 * manager needs to know how long identifiable detail is kept in order to answer
 * for it; shortening that window is a different act, and one whose consequence
 * is deletion.
 *
 * Shape validation lives here; every semantic rule — the bounds that mirror
 * migration 518's CHECKs, and the dry-run gate on shortening — lives in
 * `versionAnalyticsRetentionSettings`, so this route and any future non-HTTP
 * caller share one rule set. Same split as `settings/driver-input.ts`.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import {
  RetentionSettingsValidationError, getEffectiveAnalyticsRetentionSettings,
  versionAnalyticsRetentionSettings, type AnalyticsRetentionSettingsChangeRequest,
} from '@/modules/fleet/incidents/analytics/settingsRepository';
import type { RetentionHoldCategory } from '@/modules/fleet/incidents/analytics/aggregateSchema';

interface Request extends NextApiRequest { user?: { id: string; role: string } }

function num(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RetentionSettingsValidationError(`${field} must be a number`);
  }
  return value;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new RetentionSettingsValidationError(`${field} must be a boolean`);
  return value;
}

function str(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new RetentionSettingsValidationError(`${field} is required`);
  return value;
}

function optionalId(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim()) throw new RetentionSettingsValidationError(`${field} must be a string`);
  return value;
}

function categories(value: unknown): RetentionHoldCategory[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new RetentionSettingsValidationError('permittedHoldCategories must be an array of strings');
  }
  // Membership is checked in the repository against the closed set, so the rule
  // has one home rather than two spellings that can drift.
  return value as RetentionHoldCategory[];
}

/**
 * Shape only. Note what is NOT read: any actor field. The session decides who
 * made the change, so a body naming someone else cannot attribute a retention
 * change to them.
 */
function parseBody(body: unknown): AnalyticsRetentionSettingsChangeRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RetentionSettingsValidationError('Request body is required');
  }
  const value = body as Record<string, unknown>;
  const changeReason = value.changeReason;
  if (changeReason !== undefined && changeReason !== null && typeof changeReason !== 'string') {
    throw new RetentionSettingsValidationError('changeReason must be a string');
  }
  return {
    effectiveFrom: str(value.effectiveFrom, 'effectiveFrom'),
    retentionMonths: num(value.retentionMonths, 'retentionMonths'),
    anonymityMinContributors: num(value.anonymityMinContributors, 'anonymityMinContributors'),
    recalculationWindowMonths: num(value.recalculationWindowMonths, 'recalculationWindowMonths'),
    retentionBatchSize: num(value.retentionBatchSize, 'retentionBatchSize'),
    maximumHoldReviewDays: num(value.maximumHoldReviewDays, 'maximumHoldReviewDays'),
    holdReviewReminderLeadDays: num(value.holdReviewReminderLeadDays, 'holdReviewReminderLeadDays'),
    aggregationRunHourSast: num(value.aggregationRunHourSast, 'aggregationRunHourSast'),
    aggregationRunMinuteSast: num(value.aggregationRunMinuteSast, 'aggregationRunMinuteSast'),
    retentionRunHourSast: num(value.retentionRunHourSast, 'retentionRunHourSast'),
    retentionRunMinuteSast: num(value.retentionRunMinuteSast, 'retentionRunMinuteSast'),
    aggregateFreshnessWarningHours: num(value.aggregateFreshnessWarningHours, 'aggregateFreshnessWarningHours'),
    retentionFreshnessWarningHours: num(value.retentionFreshnessWarningHours, 'retentionFreshnessWarningHours'),
    permittedHoldCategories: categories(value.permittedHoldCategories),
    metricVersion: num(value.metricVersion, 'metricVersion'),
    liveRetentionEnabled: bool(value.liveRetentionEnabled, 'liveRetentionEnabled'),
    changeReason: (changeReason as string | null | undefined) ?? null,
    acknowledgedDryRunId: optionalId(value.acknowledgedDryRunId, 'acknowledgedDryRunId'),
  };
}

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  try {
    if (req.method === 'GET') {
      return apiResponse.success(res, await getEffectiveAnalyticsRetentionSettings(new Date().toISOString()));
    }
    const created = await versionAnalyticsRetentionSettings(parseBody(req.body), user.id);
    return apiResponse.created(res, created);
  } catch (error) {
    // The repository's own words reach the caller: "shorten from 12 to 6
    // months" is actionable where "Internal server error" is not.
    if (error instanceof RetentionSettingsValidationError) return apiResponse.badRequest(res, error.message);
    log.error('Failed to manage Fleet analytics/retention settings', { error, method: req.method }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
  }
  const action = req.method === 'POST' ? 'edit' : 'view';
  return withPermission('fleet.incidents-settings', action)(handler)(req, res);
}
export default withAuth(route);

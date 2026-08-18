/**
 * Pure request-shape validation for the incident-settings surface (rule
 * versioning and oversight membership). Deep numeric-range/date/reason
 * validation for rule changes still lives in `settingsRepository`'s
 * `versionIncidentRule` (design already covered by its own tests) — this
 * module only confirms the body has the right shape before that call.
 */
import { isValidUUID } from '../services/mileageUtils';
import { parseStrictIsoInstant } from '../operations/instantValidation';
import { IncidentValidationError, INCIDENT_TYPES, OUTCOMES, SEVERITIES } from './reviewValidation';
import type { IncidentOutcome, IncidentRuleChangeRequest, IncidentSeverity, IncidentType } from './types';

export { IncidentValidationError };

const CHANNEL_KEYS = ['inApp', 'email', 'whatsapp'] as const;

export function parseRuleChangeBody(body: unknown): Omit<IncidentRuleChangeRequest, 'actorUserId'> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new IncidentValidationError('Request body is required');
  const value = body as Record<string, unknown>;
  if (typeof value.incidentType !== 'string' || !INCIDENT_TYPES.includes(value.incidentType as IncidentType)) {
    throw new IncidentValidationError('incidentType is invalid');
  }
  if (typeof value.enabled !== 'boolean') throw new IncidentValidationError('enabled must be a boolean');
  if (typeof value.createsIncident !== 'boolean') throw new IncidentValidationError('createsIncident must be a boolean');
  if (typeof value.severity !== 'string' || !SEVERITIES.includes(value.severity as IncidentSeverity)) {
    throw new IncidentValidationError('severity is invalid');
  }
  if (typeof value.immediateNotification !== 'boolean') throw new IncidentValidationError('immediateNotification must be a boolean');
  const channels = value.channels;
  if (!channels || typeof channels !== 'object' || Array.isArray(channels)) throw new IncidentValidationError('channels is required');
  const channelValue = channels as Record<string, unknown>;
  if (CHANNEL_KEYS.some((key) => typeof channelValue[key] !== 'boolean')) {
    throw new IncidentValidationError('channels.inApp/email/whatsapp must each be a boolean');
  }
  if (typeof value.includeInMorningSummary !== 'boolean') throw new IncidentValidationError('includeInMorningSummary must be a boolean');
  if (typeof value.acknowledgementTargetMinutes !== 'number') throw new IncidentValidationError('acknowledgementTargetMinutes must be a number');
  if (typeof value.reminderIntervalMinutes !== 'number') throw new IncidentValidationError('reminderIntervalMinutes must be a number');
  if (typeof value.maximumEscalationLevel !== 'number') throw new IncidentValidationError('maximumEscalationLevel must be a number');
  if (!Array.isArray(value.evidenceRequiredOutcomes)
    || value.evidenceRequiredOutcomes.some((outcome) => typeof outcome !== 'string' || !OUTCOMES.includes(outcome as IncidentOutcome))) {
    throw new IncidentValidationError('evidenceRequiredOutcomes must be an array of valid outcomes');
  }
  if (typeof value.effectiveFrom !== 'string' || !value.effectiveFrom) throw new IncidentValidationError('effectiveFrom is required');
  if (typeof value.changeReason !== 'string' || !value.changeReason.trim()) throw new IncidentValidationError('changeReason is required');
  return {
    incidentType: value.incidentType as IncidentType, enabled: value.enabled, createsIncident: value.createsIncident,
    severity: value.severity as IncidentSeverity, immediateNotification: value.immediateNotification,
    channels: { inApp: channelValue.inApp as boolean, email: channelValue.email as boolean, whatsapp: channelValue.whatsapp as boolean },
    includeInMorningSummary: value.includeInMorningSummary,
    acknowledgementTargetMinutes: value.acknowledgementTargetMinutes,
    reminderIntervalMinutes: value.reminderIntervalMinutes,
    maximumEscalationLevel: value.maximumEscalationLevel,
    evidenceRequiredOutcomes: value.evidenceRequiredOutcomes as IncidentOutcome[],
    effectiveFrom: value.effectiveFrom, changeReason: value.changeReason,
  };
}

export interface ParsedOversightAddBody { userId: string; effectiveFrom: string | undefined; reason: string | null }

export function parseOversightAddBody(body: unknown): ParsedOversightAddBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new IncidentValidationError('Request body is required');
  const value = body as Record<string, unknown>;
  if (typeof value.userId !== 'string' || !isValidUUID(value.userId)) throw new IncidentValidationError('userId must be a valid UUID');
  let effectiveFrom: string | undefined;
  if (value.effectiveFrom !== undefined) {
    if (typeof value.effectiveFrom !== 'string' || parseStrictIsoInstant(value.effectiveFrom) === null) {
      throw new IncidentValidationError('effectiveFrom must be a valid ISO instant');
    }
    effectiveFrom = value.effectiveFrom;
  }
  const reason = typeof value.reason === 'string' && value.reason.trim() ? value.reason.trim() : null;
  return { userId: value.userId, effectiveFrom, reason };
}

export interface ParsedOversightEndBody { membershipId: string; reason: string; endedAt: string | undefined }

export function parseOversightEndBody(body: unknown): ParsedOversightEndBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new IncidentValidationError('Request body is required');
  const value = body as Record<string, unknown>;
  if (typeof value.membershipId !== 'string' || !isValidUUID(value.membershipId)) throw new IncidentValidationError('membershipId must be a valid UUID');
  if (typeof value.reason !== 'string' || !value.reason.trim()) throw new IncidentValidationError('reason is required to end oversight membership');
  let endedAt: string | undefined;
  if (value.endedAt !== undefined) {
    if (typeof value.endedAt !== 'string' || parseStrictIsoInstant(value.endedAt) === null) {
      throw new IncidentValidationError('endedAt must be a valid ISO instant');
    }
    endedAt = value.endedAt;
  }
  return { membershipId: value.membershipId, reason: value.reason.trim(), endedAt };
}

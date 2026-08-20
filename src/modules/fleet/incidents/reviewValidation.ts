/**
 * Pure request-shape validation for the manager incident-review surface
 * (list filters, one lifecycle/comment transition, and bulk acknowledgement).
 * No database access here — these functions only decide whether a request
 * is well-formed; `reviewScope`/`reviewQueries`/`reviewTransitions` decide
 * whether it is permitted or possible. See `incidentSettingsValidation.ts`
 * for the sibling settings (rules/oversight) body parsers, split out to
 * keep each file under the project's 300-line cap.
 */
import { isValidDate, isValidUUID } from '../services/mileageUtils';
import type { IncidentListRequest, IncidentLifecycleStatus, IncidentOutcome, IncidentSeverity, IncidentType } from './types';

export class IncidentValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'IncidentValidationError'; }
}

const LIFECYCLE_STATUSES: readonly IncidentLifecycleStatus[] = ['open', 'acknowledged', 'under_review', 'resolved', 'dismissed'];
export const INCIDENT_TYPES: readonly IncidentType[] = [
  'late', 'wrong_site', 'evidence_mismatch', 'left_early',
  'unassigned', 'unverifiable', 'evidence_gap', 'vehicle_on_site_driver_unconfirmed',
  'accident_sos', 'dangerous_area_entry', 'theft_after_hours_movement', 'severe_driving',
  'prolonged_unauthorized_stop', 'lost_contact_moving',
];
export const SEVERITIES: readonly IncidentSeverity[] = ['normal', 'high', 'critical'];
export const OUTCOMES: readonly IncidentOutcome[] = [
  'confirmed', 'valid_reason', 'false_positive', 'data_gap',
  'assignment_error', 'geofence_error', 'duplicate', 'no_action_required',
];
const RESOLVED_OUTCOMES = new Set<IncidentOutcome>(['confirmed', 'valid_reason', 'assignment_error', 'geofence_error', 'no_action_required']);
const DISMISSED_OUTCOMES = new Set<IncidentOutcome>(['false_positive', 'data_gap', 'duplicate']);
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
const MAX_BULK_IDS = 50;
const TRANSITION_ACTION_TYPES = ['acknowledged', 'review_started', 'commented', 'resolved', 'dismissed'] as const;

type QueryValue = string | string[] | undefined;
function str(value: QueryValue): string | undefined { return typeof value === 'string' ? value : undefined; }
function csv(value: QueryValue): string[] | undefined {
  if (value === undefined) return undefined;
  const raw = Array.isArray(value) ? value.join(',') : value;
  const items = raw.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new IncidentValidationError(`${field} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new IncidentValidationError(`${field} must be a positive integer`);
  return parsed;
}

function parseEnumList<T extends string>(value: QueryValue, allowed: readonly T[], field: string): T[] | undefined {
  const items = csv(value);
  if (!items) return undefined;
  return items.map((item) => {
    if (!allowed.includes(item as T)) throw new IncidentValidationError(`Invalid ${field}: ${item}`);
    return item as T;
  });
}

function parseUuidFilter(value: QueryValue, field: string): string | undefined {
  const parsed = str(value);
  if (parsed === undefined) return undefined;
  if (!isValidUUID(parsed)) throw new IncidentValidationError(`${field} must be a valid UUID`);
  return parsed;
}

function parseDateFilter(value: QueryValue, field: string): string | undefined {
  const parsed = str(value);
  if (parsed === undefined) return undefined;
  if (!isValidDate(parsed)) throw new IncidentValidationError(`${field} must be a valid YYYY-MM-DD date`);
  return parsed;
}

export function parseIncidentListQuery(query: Record<string, QueryValue>): IncidentListRequest {
  const lifecycleStatuses = parseEnumList(query.lifecycleStatus, LIFECYCLE_STATUSES, 'lifecycleStatus');
  const incidentTypes = parseEnumList(query.incidentType, INCIDENT_TYPES, 'incidentType');
  const severities = parseEnumList(query.severity, SEVERITIES, 'severity');
  const projectId = parseUuidFilter(query.projectId, 'projectId');
  const managerUserId = parseUuidFilter(query.managerUserId, 'managerUserId');
  const staffId = parseUuidFilter(query.staffId, 'staffId');
  const fromDate = parseDateFilter(query.fromDate, 'fromDate');
  const toDate = parseDateFilter(query.toDate, 'toDate');
  const conditionState = str(query.conditionState);
  if (conditionState !== undefined && conditionState !== 'active' && conditionState !== 'cleared') {
    throw new IncidentValidationError('conditionState must be active or cleared');
  }
  const evidenceState = str(query.evidenceState);
  if (evidenceState !== undefined && evidenceState !== 'required' && evidenceState !== 'present') {
    throw new IncidentValidationError('evidenceState must be required or present');
  }
  const page = parsePositiveInt(str(query.page), 1, 'page');
  const limit = parsePositiveInt(str(query.limit), DEFAULT_LIMIT, 'limit');
  if (limit > MAX_LIMIT) throw new IncidentValidationError(`limit cannot exceed ${MAX_LIMIT}`);
  return {
    lifecycleStatuses, projectId, managerUserId, incidentTypes, severities, staffId, fromDate, toDate,
    overdueOnly: str(query.overdueOnly) === 'true',
    conditionState: conditionState as 'active' | 'cleared' | undefined,
    evidenceState: evidenceState as 'required' | 'present' | undefined,
    limit, offset: (page - 1) * limit,
  };
}

export interface ParsedTransitionBody {
  actionType: (typeof TRANSITION_ACTION_TYPES)[number];
  note: string | null;
  outcome: IncidentOutcome | null;
  linkedIncidentReference: string | null;
  requestCorrelationId: string | null;
}

export function parseTransitionBody(body: unknown): ParsedTransitionBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new IncidentValidationError('Request body is required');
  const value = body as Record<string, unknown>;
  const actionType = value.actionType;
  if (typeof actionType !== 'string' || !TRANSITION_ACTION_TYPES.includes(actionType as (typeof TRANSITION_ACTION_TYPES)[number])) {
    throw new IncidentValidationError('actionType is invalid');
  }
  const note = typeof value.note === 'string' && value.note.trim() ? value.note.trim() : null;
  if ((actionType === 'commented' || actionType === 'resolved' || actionType === 'dismissed') && !note) {
    throw new IncidentValidationError(`note is required for ${actionType}`);
  }
  let outcome: IncidentOutcome | null = null;
  if (actionType === 'resolved' || actionType === 'dismissed') {
    if (typeof value.outcome !== 'string' || !OUTCOMES.includes(value.outcome as IncidentOutcome)) {
      throw new IncidentValidationError('outcome is required and must be a valid outcome');
    }
    outcome = value.outcome as IncidentOutcome;
    const allowed = actionType === 'resolved' ? RESOLVED_OUTCOMES : DISMISSED_OUTCOMES;
    if (!allowed.has(outcome)) throw new IncidentValidationError(`outcome ${outcome} is not valid for ${actionType}`);
  }
  let linkedIncidentReference: string | null = null;
  if (outcome === 'duplicate') {
    if (typeof value.linkedIncidentReference !== 'string' || !value.linkedIncidentReference.trim()) {
      throw new IncidentValidationError('linkedIncidentReference is required for a duplicate outcome');
    }
    linkedIncidentReference = value.linkedIncidentReference.trim();
  }
  const requestCorrelationId = typeof value.requestCorrelationId === 'string' ? value.requestCorrelationId : null;
  return { actionType: actionType as ParsedTransitionBody['actionType'], note, outcome, linkedIncidentReference, requestCorrelationId };
}

export function parseBulkAcknowledgeBody(body: unknown): string[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new IncidentValidationError('Request body is required');
  const value = body as Record<string, unknown>;
  const ids = value.incidentIds;
  if (!Array.isArray(ids) || ids.length === 0) throw new IncidentValidationError('incidentIds must be a non-empty array');
  if (ids.length > MAX_BULK_IDS) throw new IncidentValidationError(`incidentIds cannot exceed ${MAX_BULK_IDS} items`);
  const unique = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || !isValidUUID(id)) throw new IncidentValidationError('incidentIds must contain only valid UUIDs');
    unique.add(id);
  }
  return [...unique];
}

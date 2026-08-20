/**
 * Effective-dated incident rule persistence and Fleet oversight membership.
 *
 * `versionIncidentRule` mirrors the proven pattern in
 * `src/modules/fleet/operations/ruleQueries.ts`: lock the current open
 * version stream for the incident type, close it at the new activation
 * instant, and insert `version + 1` inside one transaction. Historical
 * incidents keep the rule id/version in effect when they were opened.
 */
import { query, queryOne, transaction } from '@/lib/db-pool';
import { parseStrictIsoInstant } from '../operations/instantValidation';
import type {
  ActiveUserOption, IncidentOutcome, IncidentRule, IncidentRuleChangeRequest, IncidentSeverity, IncidentType,
  OversightMembership, OversightMembershipRequest,
} from './types';

export class IncidentSettingsValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'IncidentSettingsValidationError'; }
}
export class OversightMembershipConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'OversightMembershipConflictError'; }
}
export class OversightMembershipNotFoundError extends Error {
  constructor(message: string) { super(message); this.name = 'OversightMembershipNotFoundError'; }
}

const RULE_COLUMNS = `id, incident_type, version, effective_from, effective_to, enabled, creates_incident,
  severity, immediate_notification, in_app_enabled, email_enabled, whatsapp_enabled,
  include_in_morning_summary, acknowledgement_target_minutes, reminder_interval_minutes,
  maximum_escalation_level, evidence_required_outcomes`;

interface RuleRow extends Record<string, unknown> {
  id: string; incident_type: IncidentType; version: number;
  effective_from: string | Date; effective_to: string | Date | null;
  enabled: boolean; creates_incident: boolean; severity: IncidentSeverity;
  immediate_notification: boolean; in_app_enabled: boolean; email_enabled: boolean; whatsapp_enabled: boolean;
  include_in_morning_summary: boolean; acknowledgement_target_minutes: number; reminder_interval_minutes: number;
  maximum_escalation_level: number; evidence_required_outcomes: IncidentOutcome[];
}

function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : value; }

function mapRule(row: RuleRow): IncidentRule {
  return {
    id: row.id, incidentType: row.incident_type, version: row.version,
    effectiveFrom: iso(row.effective_from), effectiveTo: row.effective_to ? iso(row.effective_to) : null,
    enabled: row.enabled, createsIncident: row.creates_incident, severity: row.severity,
    immediateNotification: row.immediate_notification,
    channels: { inApp: row.in_app_enabled, email: row.email_enabled, whatsapp: row.whatsapp_enabled },
    includeInMorningSummary: row.include_in_morning_summary,
    acknowledgementTargetMinutes: row.acknowledgement_target_minutes,
    reminderIntervalMinutes: row.reminder_interval_minutes,
    maximumEscalationLevel: row.maximum_escalation_level,
    evidenceRequiredOutcomes: row.evidence_required_outcomes,
  };
}

export async function loadEffectiveIncidentRule(incidentType: IncidentType, asOf: string): Promise<IncidentRule | null> {
  const row = await queryOne<RuleRow>(
    `SELECT ${RULE_COLUMNS} FROM fleet_operational_incident_rules
     WHERE incident_type = $1 AND effective_from <= $2::timestamptz
       AND (effective_to IS NULL OR effective_to > $2::timestamptz)
     ORDER BY version DESC LIMIT 1`,
    [incidentType, asOf],
  );
  return row ? mapRule(row) : null;
}

export async function listIncidentRuleVersions(incidentType: IncidentType): Promise<IncidentRule[]> {
  const rows = await query<RuleRow>(
    `SELECT ${RULE_COLUMNS} FROM fleet_operational_incident_rules WHERE incident_type = $1 ORDER BY version DESC`,
    [incidentType],
  );
  return rows.map(mapRule);
}

const MAX_BACKDATE_MS = 60_000;
const OUTCOMES: readonly IncidentOutcome[] = [
  'confirmed', 'valid_reason', 'false_positive', 'data_gap',
  'assignment_error', 'geofence_error', 'duplicate', 'no_action_required',
];
const SEVERITIES: readonly IncidentSeverity[] = ['normal', 'high', 'critical'];

function validateChangeRequest(request: IncidentRuleChangeRequest): { effectiveFrom: string; reason: string } {
  const effectiveMs = parseStrictIsoInstant(request.effectiveFrom);
  if (effectiveMs === null) throw new IncidentSettingsValidationError('effectiveFrom must be a valid ISO instant');
  if (effectiveMs < Date.now() - MAX_BACKDATE_MS) {
    throw new IncidentSettingsValidationError('effectiveFrom cannot be more than one minute in the past');
  }
  if (!SEVERITIES.includes(request.severity)) throw new IncidentSettingsValidationError('severity is invalid');
  if (!Number.isInteger(request.acknowledgementTargetMinutes) || request.acknowledgementTargetMinutes <= 0) {
    throw new IncidentSettingsValidationError('acknowledgementTargetMinutes must be a positive integer');
  }
  if (!Number.isInteger(request.reminderIntervalMinutes) || request.reminderIntervalMinutes <= 0) {
    throw new IncidentSettingsValidationError('reminderIntervalMinutes must be a positive integer');
  }
  if (!Number.isInteger(request.maximumEscalationLevel) || request.maximumEscalationLevel < 0) {
    throw new IncidentSettingsValidationError('maximumEscalationLevel must be a non-negative integer');
  }
  if (request.evidenceRequiredOutcomes.some((outcome) => !OUTCOMES.includes(outcome))) {
    throw new IncidentSettingsValidationError('evidenceRequiredOutcomes contains an invalid outcome');
  }
  const reason = request.changeReason.trim();
  if (!reason) throw new IncidentSettingsValidationError('changeReason is required');
  return { effectiveFrom: new Date(effectiveMs).toISOString(), reason };
}

export async function versionIncidentRule(request: IncidentRuleChangeRequest): Promise<IncidentRule> {
  const normalized = validateChangeRequest(request);
  return transaction(async (txn) => {
    const current = await txn.queryOne<RuleRow>(
      `SELECT ${RULE_COLUMNS} FROM fleet_operational_incident_rules
       WHERE incident_type = $1 AND effective_to IS NULL ORDER BY version DESC LIMIT 1 FOR UPDATE`,
      [request.incidentType],
    );
    if (!current) throw new IncidentSettingsValidationError(`No open incident rule exists for ${request.incidentType}`);
    if (new Date(normalized.effectiveFrom).getTime() <= new Date(iso(current.effective_from)).getTime()) {
      throw new IncidentSettingsValidationError('effectiveFrom must be after the current rule activation');
    }
    await txn.query(
      `UPDATE fleet_operational_incident_rules SET effective_to = $1::timestamptz, updated_at = now() WHERE id = $2::uuid`,
      [normalized.effectiveFrom, current.id],
    );
    const values = [
      request.incidentType, current.version + 1, normalized.effectiveFrom, request.enabled, request.createsIncident,
      request.severity, request.immediateNotification, request.channels.inApp, request.channels.email,
      request.channels.whatsapp, request.includeInMorningSummary, request.acknowledgementTargetMinutes,
      request.reminderIntervalMinutes, request.maximumEscalationLevel, request.evidenceRequiredOutcomes,
      request.actorUserId, normalized.reason,
    ];
    const created = await txn.queryOne<RuleRow>(
      `INSERT INTO fleet_operational_incident_rules
        (incident_type, version, effective_from, enabled, creates_incident, severity, immediate_notification,
         in_app_enabled, email_enabled, whatsapp_enabled, include_in_morning_summary,
         acknowledgement_target_minutes, reminder_interval_minutes, maximum_escalation_level,
         evidence_required_outcomes, created_by, change_reason)
       VALUES ($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::text[],$16::uuid,$17)
       RETURNING ${RULE_COLUMNS}`,
      values,
    );
    if (!created) throw new Error('Incident rule insert returned no row');
    return mapRule(created);
  });
}

const MEMBERSHIP_COLUMNS = `id, user_id, effective_from, effective_to, reason`;

interface MembershipRow extends Record<string, unknown> {
  id: string; user_id: string; effective_from: string | Date; effective_to: string | Date | null; reason: string | null;
}

function mapMembership(row: MembershipRow): OversightMembership {
  return {
    id: row.id, userId: row.user_id, effectiveFrom: iso(row.effective_from),
    effectiveTo: row.effective_to ? iso(row.effective_to) : null, reason: row.reason,
  };
}

export async function listOversightMembers(options: { activeOnly?: boolean } = {}): Promise<OversightMembership[]> {
  if (options.activeOnly) {
    const rows = await query<MembershipRow>(
      `SELECT ${MEMBERSHIP_COLUMNS} FROM fleet_operational_oversight_members
       WHERE effective_to IS NULL ORDER BY effective_from ASC`,
    );
    return rows.map(mapMembership);
  }
  const rows = await query<MembershipRow>(
    `SELECT ${MEMBERSHIP_COLUMNS} FROM fleet_operational_oversight_members ORDER BY effective_from DESC`,
  );
  return rows.map(mapMembership);
}

const UNIQUE_VIOLATION_CODE = '23505';
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION_CODE;
}

export async function addOversightMember(request: OversightMembershipRequest): Promise<OversightMembership> {
  const effectiveFrom = request.effectiveFrom ?? new Date().toISOString();
  if (parseStrictIsoInstant(effectiveFrom) === null) {
    throw new IncidentSettingsValidationError('effectiveFrom must be a valid ISO instant');
  }
  const reason = request.reason?.trim() || null;
  try {
    const created = await queryOne<MembershipRow>(
      `INSERT INTO fleet_operational_oversight_members (user_id, effective_from, added_by, reason)
       VALUES ($1::uuid, $2::timestamptz, $3::uuid, $4) RETURNING ${MEMBERSHIP_COLUMNS}`,
      [request.userId, effectiveFrom, request.actorUserId, reason],
    );
    if (!created) throw new Error('Oversight membership insert returned no row');
    return mapMembership(created);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new OversightMembershipConflictError(`User ${request.userId} already has an active oversight membership`);
    }
    throw error;
  }
}

export async function endOversightMembership(
  id: string, endedByUserId: string, reason: string, endedAt?: string,
): Promise<OversightMembership> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new IncidentSettingsValidationError('reason is required to end oversight membership');
  const effectiveTo = endedAt ?? new Date().toISOString();
  if (parseStrictIsoInstant(effectiveTo) === null) {
    throw new IncidentSettingsValidationError('endedAt must be a valid ISO instant');
  }
  const updated = await queryOne<MembershipRow>(
    `UPDATE fleet_operational_oversight_members
     SET effective_to = $2::timestamptz, ended_by = $3::uuid, reason = $4, updated_at = now()
     WHERE id = $1::uuid AND effective_to IS NULL
     RETURNING ${MEMBERSHIP_COLUMNS}`,
    [id, effectiveTo, endedByUserId, trimmedReason],
  );
  if (!updated) throw new OversightMembershipNotFoundError(`No active oversight membership found for id ${id}`);
  return mapMembership(updated);
}

interface ActiveUserRow extends Record<string, unknown> { id: string; first_name: string | null; last_name: string | null }

function mapActiveUser(row: ActiveUserRow): ActiveUserOption {
  const name = [row.first_name, row.last_name].filter((part) => Boolean(part && part.trim())).join(' ').trim();
  return { id: row.id, name: name || 'Unnamed user' };
}

const USER_SEARCH_LIMIT = 20;

/**
 * Active-only user search for the incident-settings "add oversight member"
 * flow (design §7). Matches on name only — the `users` table's `email`
 * column is never selected or referenced here — so only `{ id, name }`
 * ever leaves this function.
 */
export async function searchActiveUsers(term: string): Promise<ActiveUserOption[]> {
  const rows = await query<ActiveUserRow>(
    `SELECT id, first_name, last_name FROM users
     WHERE is_active = true AND (first_name ILIKE $1 OR last_name ILIKE $1)
     ORDER BY first_name ASC NULLS LAST, last_name ASC NULLS LAST
     LIMIT $2`,
    [`%${term}%`, USER_SEARCH_LIMIT],
  );
  return rows.map(mapActiveUser);
}

/** Resolves display names for a known set of user ids (active only), so oversight
 * membership rows can render a name instead of the raw `userId` UUID. */
export async function resolveActiveUserNames(userIds: string[]): Promise<ActiveUserOption[]> {
  if (userIds.length === 0) return [];
  const rows = await query<ActiveUserRow>(
    `SELECT id, first_name, last_name FROM users WHERE is_active = true AND id = ANY($1::uuid[])`,
    [userIds],
  );
  return rows.map(mapActiveUser);
}

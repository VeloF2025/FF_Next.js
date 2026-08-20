/**
 * Incident, observation, action, and evidence persistence. Every mutation
 * helper takes a caller-supplied `TxnClient` (never opens its own
 * transaction) so the producer and review transitions own atomicity across
 * several calls at once — see `fleet/parking/approvalQueries.ts` for the
 * same single-connection pattern. Observations/actions/evidence are
 * append-only; the migration grants this module INSERT/SELECT only there.
 */
import { randomUUID } from 'node:crypto';
import type { TxnClient } from '@/lib/db-pool';
import type {
  IncidentAction, IncidentActionType, IncidentEvidence, IncidentEvidenceType,
  IncidentLifecycleStatus, IncidentSeverity, IncidentType, SanitizedIncidentMetadata,
} from './types';

const NULL_ASSIGNMENT_SENTINEL = '00000000-0000-0000-0000-000000000000';
const ACTIVE_STATUSES: IncidentLifecycleStatus[] = ['open', 'acknowledged', 'under_review'];
const TERMINAL_STATUSES: IncidentLifecycleStatus[] = ['resolved', 'dismissed'];

export class IncidentNotFoundError extends Error {
  constructor(message: string) { super(message); this.name = 'IncidentNotFoundError'; }
}

const INCIDENT_COLUMNS = `id, incident_reference, incident_type, severity, lifecycle_status,
  staff_id, project_id, operational_site_id, vehicle_id, operational_assignment_id, work_date,
  staff_name_snapshot, project_name_snapshot, operational_site_name_snapshot, vehicle_registration_snapshot,
  source_event_id, status_rule_id, status_rule_version, incident_rule_id, incident_rule_version,
  evidence_snapshot, detected_at, opened_at, condition_last_seen_at, condition_cleared_at,
  acknowledged_by, acknowledged_at, review_started_by, review_started_at,
  escalation_level, last_escalated_at, next_escalation_at,
  resolved_by, resolved_at, outcome, resolution_note,
  duplicate_incident_id, linked_hs_reference, linked_maintenance_reference`;

interface IncidentRow extends Record<string, unknown> {
  id: string; incident_reference: string; incident_type: IncidentType; severity: IncidentSeverity; lifecycle_status: IncidentLifecycleStatus;
  staff_id: string | null; project_id: string | null; operational_site_id: string | null; vehicle_id: string | null; operational_assignment_id: string | null;
  work_date: string | Date | null; staff_name_snapshot: string | null; project_name_snapshot: string | null;
  operational_site_name_snapshot: string | null; vehicle_registration_snapshot: string | null; source_event_id: string | null;
  status_rule_id: string | null; status_rule_version: number | null; incident_rule_id: string | null; incident_rule_version: number | null;
  evidence_snapshot: SanitizedIncidentMetadata; detected_at: string | Date; opened_at: string | Date;
  condition_last_seen_at: string | Date | null; condition_cleared_at: string | Date | null;
  acknowledged_by: string | null; acknowledged_at: string | Date | null; review_started_by: string | null; review_started_at: string | Date | null;
  escalation_level: number; last_escalated_at: string | Date | null; next_escalation_at: string | Date | null;
  resolved_by: string | null; resolved_at: string | Date | null; outcome: string | null; resolution_note: string | null;
  duplicate_incident_id: string | null; linked_hs_reference: string | null; linked_maintenance_reference: string | null;
}

export interface IncidentRecord {
  id: string; incidentReference: string; incidentType: IncidentType; severity: IncidentSeverity; lifecycleStatus: IncidentLifecycleStatus;
  staffId: string | null; projectId: string | null; operationalSiteId: string | null; vehicleId: string | null; operationalAssignmentId: string | null;
  workDate: string | null; detectedAt: string; openedAt: string; conditionLastSeenAt: string | null; conditionClearedAt: string | null;
  acknowledgedBy: string | null; acknowledgedAt: string | null; reviewStartedBy: string | null; reviewStartedAt: string | null;
  escalationLevel: number; lastEscalatedAt: string | null; nextEscalationAt: string | null;
  resolvedBy: string | null; resolvedAt: string | null; outcome: string | null; resolutionNote: string | null;
  linkedHsReference: string | null; linkedMaintenanceReference: string | null;
}

function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : value; }
function isoOrNull(value: string | Date | null): string | null { return value === null ? null : iso(value); }
function dateOnly(value: string | Date): string { return value instanceof Date ? value.toISOString().slice(0, 10) : value; }
function dateOrNull(value: string | Date | null): string | null { return value === null ? null : dateOnly(value); }

function mapIncident(row: IncidentRow): IncidentRecord {
  return {
    id: row.id, incidentReference: row.incident_reference, incidentType: row.incident_type, severity: row.severity,
    lifecycleStatus: row.lifecycle_status, staffId: row.staff_id, projectId: row.project_id,
    operationalSiteId: row.operational_site_id, vehicleId: row.vehicle_id, operationalAssignmentId: row.operational_assignment_id,
    workDate: dateOrNull(row.work_date), detectedAt: iso(row.detected_at), openedAt: iso(row.opened_at),
    conditionLastSeenAt: isoOrNull(row.condition_last_seen_at), conditionClearedAt: isoOrNull(row.condition_cleared_at),
    acknowledgedBy: row.acknowledged_by, acknowledgedAt: isoOrNull(row.acknowledged_at),
    reviewStartedBy: row.review_started_by, reviewStartedAt: isoOrNull(row.review_started_at),
    escalationLevel: row.escalation_level, lastEscalatedAt: isoOrNull(row.last_escalated_at), nextEscalationAt: isoOrNull(row.next_escalation_at),
    resolvedBy: row.resolved_by, resolvedAt: isoOrNull(row.resolved_at), outcome: row.outcome, resolutionNote: row.resolution_note,
    linkedHsReference: row.linked_hs_reference, linkedMaintenanceReference: row.linked_maintenance_reference,
  };
}

// `INC-<TYPE>-<YYYYMMDD>-<6 hex>`. No sequence table backs this (migration 506 defines none); the random suffix
// makes a collision astronomically unlikely, and `incident_reference` carries its own UNIQUE constraint as a
// backstop, so no retry loop is warranted here.
function buildIncidentReference(incidentType: IncidentType, detectedAt: string): string {
  const datePart = detectedAt.slice(0, 10).replace(/-/g, '');
  const typeCode = incidentType.replace(/[^a-z]/gi, '').slice(0, 4).toUpperCase();
  const suffix = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `INC-${typeCode}-${datePart}-${suffix}`;
}

export interface FindActiveIncidentParams { staffId: string; incidentType: IncidentType; workDate: string; operationalAssignmentId: string | null }

/** Locks the one active incident (if any) for this staff/type/date/assignment, normalizing a null assignment to the same sentinel the partial unique index uses. */
export async function findActiveIncident(params: FindActiveIncidentParams, txn: TxnClient): Promise<IncidentRecord | null> {
  const row = await txn.queryOne<IncidentRow>(
    `SELECT ${INCIDENT_COLUMNS} FROM fleet_operational_incidents
     WHERE staff_id = $1::uuid AND incident_type = $2 AND work_date = $3::date
       AND COALESCE(operational_assignment_id, $5::uuid) = COALESCE($4::uuid, $5::uuid)
       AND lifecycle_status = ANY($6::text[])
     FOR UPDATE`,
    [params.staffId, params.incidentType, params.workDate, params.operationalAssignmentId, NULL_ASSIGNMENT_SENTINEL, ACTIVE_STATUSES],
  );
  return row ? mapIncident(row) : null;
}

/** Locks any incident already claiming this source event id, regardless of lifecycle status — source events dedupe forever, not just while active. */
export async function findIncidentBySourceEvent(incidentType: IncidentType, sourceEventId: string, txn: TxnClient): Promise<IncidentRecord | null> {
  const row = await txn.queryOne<IncidentRow>(
    `SELECT ${INCIDENT_COLUMNS} FROM fleet_operational_incidents
     WHERE incident_type = $1 AND source_event_id = $2
     FOR UPDATE`,
    [incidentType, sourceEventId],
  );
  return row ? mapIncident(row) : null;
}

export interface CreateIncidentInput {
  incidentType: IncidentType; severity: IncidentSeverity; staffId: string | null; projectId: string | null;
  operationalSiteId: string | null; vehicleId: string | null; operationalAssignmentId: string | null; workDate: string | null;
  staffNameSnapshot: string | null; projectNameSnapshot: string | null; operationalSiteNameSnapshot: string | null;
  vehicleRegistrationSnapshot: string | null; sourceEventId: string | null; statusRuleId: string | null; statusRuleVersion: number | null;
  incidentRuleId: string | null; incidentRuleVersion: number | null; evidenceSnapshot: SanitizedIncidentMetadata; detectedAt: string;
  linkedHsReference: string | null; linkedMaintenanceReference: string | null;
}

/** Opens a new incident. The active partial unique index and source-event unique index are the final concurrency backstop; callers still lock via find* first to avoid a doomed insert under normal contention. */
export async function createIncident(input: CreateIncidentInput, txn: TxnClient): Promise<IncidentRecord> {
  const incidentReference = buildIncidentReference(input.incidentType, input.detectedAt);
  const values = [
    incidentReference, input.incidentType, input.severity, input.staffId, input.projectId,
    input.operationalSiteId, input.vehicleId, input.operationalAssignmentId, input.workDate,
    input.staffNameSnapshot, input.projectNameSnapshot, input.operationalSiteNameSnapshot,
    input.vehicleRegistrationSnapshot, input.sourceEventId, input.statusRuleId, input.statusRuleVersion,
    input.incidentRuleId, input.incidentRuleVersion, input.evidenceSnapshot, input.detectedAt,
    input.detectedAt, input.linkedHsReference, input.linkedMaintenanceReference,
  ];
  const created = await txn.queryOne<IncidentRow>(
    `INSERT INTO fleet_operational_incidents
      (incident_reference, incident_type, severity, staff_id, project_id, operational_site_id, vehicle_id,
       operational_assignment_id, work_date, staff_name_snapshot, project_name_snapshot,
       operational_site_name_snapshot, vehicle_registration_snapshot, source_event_id,
       status_rule_id, status_rule_version, incident_rule_id, incident_rule_version,
       evidence_snapshot, detected_at, condition_last_seen_at, linked_hs_reference, linked_maintenance_reference)
     VALUES ($1,$2,$3,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::uuid,$9::date,$10,$11,$12,$13,$14,
       $15::uuid,$16,$17::uuid,$18,$19::jsonb,$20::timestamptz,$21::timestamptz,$22,$23)
     RETURNING ${INCIDENT_COLUMNS}`,
    values,
  );
  if (!created) throw new Error('Incident insert returned no row');
  return mapIncident(created);
}

/** Recurrence: the monitor still sees the condition. Clears any prior `condition_cleared_at` — a healthy gap followed by recurrence is not still "cleared". */
export async function touchIncidentLastSeen(incidentId: string, observedAt: string, txn: TxnClient): Promise<void> {
  await txn.query(
    `UPDATE fleet_operational_incidents
     SET condition_last_seen_at = $2::timestamptz, condition_cleared_at = NULL, updated_at = now()
     WHERE id = $1::uuid`,
    [incidentId, observedAt],
  );
}

/** Marks the condition cleared under healthy evidence. Idempotent: only the first clearing after a recurrence takes effect. Never resolves/dismisses the incident. */
export async function clearIncidentCondition(incidentId: string, clearedAt: string, txn: TxnClient): Promise<void> {
  await txn.query(
    `UPDATE fleet_operational_incidents SET condition_cleared_at = $2::timestamptz, updated_at = now()
     WHERE id = $1::uuid AND condition_cleared_at IS NULL`,
    [incidentId, clearedAt],
  );
}

export interface RecordObservationInput {
  incidentId: string; observationFingerprint: string; observedAt: string;
  primaryStatus: string | null; flags: string[]; ruleId: string | null; ruleVersion: number | null;
  evidenceSnapshot: SanitizedIncidentMetadata; reasonCodes: string[];
  monitorRunId: string | null; sourceEventId: string | null;
}
export interface RecordObservationResult { inserted: boolean; observationId: string | null }

/** Append-only; `ON CONFLICT DO NOTHING` on `(incident_id, observation_fingerprint)` is the unchanged-observation dedup. */
export async function recordObservation(input: RecordObservationInput, txn: TxnClient): Promise<RecordObservationResult> {
  const row = await txn.queryOne<{ id: string }>(
    `INSERT INTO fleet_operational_incident_observations
      (incident_id, observation_fingerprint, observed_at, primary_status, flags, rule_id, rule_version,
       evidence_snapshot, reason_codes, monitor_run_id, source_event_id)
     VALUES ($1::uuid,$2,$3::timestamptz,$4,$5::text[],$6::uuid,$7,$8::jsonb,$9::text[],$10::uuid,$11)
     ON CONFLICT (incident_id, observation_fingerprint) DO NOTHING
     RETURNING id`,
    [input.incidentId, input.observationFingerprint, input.observedAt, input.primaryStatus, input.flags,
      input.ruleId, input.ruleVersion, input.evidenceSnapshot, input.reasonCodes, input.monitorRunId, input.sourceEventId],
  );
  return { inserted: row !== null, observationId: row?.id ?? null };
}

export interface InsertActionInput {
  incidentId: string; actionType: IncidentActionType; actorUserId: string | null; isSystemActor: boolean; note: string | null;
  beforeLifecycleStatus: IncidentLifecycleStatus | null; afterLifecycleStatus: IncidentLifecycleStatus | null;
  beforeEscalationLevel: number | null; afterEscalationLevel: number | null; metadata: SanitizedIncidentMetadata; requestCorrelationId: string | null;
}

interface ActionRow extends Record<string, unknown> {
  id: string; action_type: IncidentActionType; actor_user_id: string | null; is_system_actor: boolean; occurred_at: string | Date; note: string | null;
  before_lifecycle_status: IncidentLifecycleStatus | null; after_lifecycle_status: IncidentLifecycleStatus | null;
  before_escalation_level: number | null; after_escalation_level: number | null; metadata: SanitizedIncidentMetadata; request_correlation_id: string | null;
}

function mapAction(row: ActionRow): IncidentAction {
  return {
    id: row.id, actionType: row.action_type, actorUserId: row.actor_user_id, isSystemActor: row.is_system_actor,
    occurredAt: iso(row.occurred_at), note: row.note, beforeLifecycleStatus: row.before_lifecycle_status,
    afterLifecycleStatus: row.after_lifecycle_status, beforeEscalationLevel: row.before_escalation_level,
    afterEscalationLevel: row.after_escalation_level, metadata: row.metadata, requestCorrelationId: row.request_correlation_id };
}

/** Append-only action history; no update/delete path is exposed here or granted at the database. */
export async function insertIncidentAction(input: InsertActionInput, txn: TxnClient): Promise<IncidentAction> {
  const created = await txn.queryOne<ActionRow>(
    `INSERT INTO fleet_operational_incident_actions
      (incident_id, action_type, actor_user_id, is_system_actor, note, before_lifecycle_status,
       after_lifecycle_status, before_escalation_level, after_escalation_level, metadata, request_correlation_id)
     VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
     RETURNING id, action_type, actor_user_id, is_system_actor, occurred_at, note, before_lifecycle_status,
       after_lifecycle_status, before_escalation_level, after_escalation_level, metadata, request_correlation_id`,
    [input.incidentId, input.actionType, input.actorUserId, input.isSystemActor, input.note,
      input.beforeLifecycleStatus, input.afterLifecycleStatus, input.beforeEscalationLevel,
      input.afterEscalationLevel, input.metadata, input.requestCorrelationId],
  );
  if (!created) throw new Error('Incident action insert returned no row');
  return mapAction(created);
}

export interface InsertEvidenceInput {
  incidentId: string; evidenceType: IncidentEvidenceType; storageUrl: string; storageKey: string;
  mimeType: string | null; originalFilename: string | null; uploadedBy: string | null; description: string | null;
}

interface EvidenceRow extends Record<string, unknown> {
  id: string; evidence_type: IncidentEvidenceType; storage_url: string; storage_key: string;
  mime_type: string | null; original_filename: string | null; uploaded_by: string | null;
  description: string | null; created_at: string | Date;
}

function mapEvidence(row: EvidenceRow): IncidentEvidence {
  return {
    id: row.id, evidenceType: row.evidence_type, storageUrl: row.storage_url, storageKey: row.storage_key,
    mimeType: row.mime_type, originalFilename: row.original_filename, uploadedBy: row.uploaded_by,
    description: row.description, createdAt: iso(row.created_at) };
}

/** Append-only evidence records; deletion is never exposed (design §15). */
export async function insertIncidentEvidence(input: InsertEvidenceInput, txn: TxnClient): Promise<IncidentEvidence> {
  const created = await txn.queryOne<EvidenceRow>(
    `INSERT INTO fleet_operational_incident_evidence
      (incident_id, evidence_type, storage_url, storage_key, mime_type, original_filename, uploaded_by, description)
     VALUES ($1::uuid,$2,$3,$4,$5,$6,$7::uuid,$8)
     RETURNING id, evidence_type, storage_url, storage_key, mime_type, original_filename, uploaded_by, description, created_at`,
    [input.incidentId, input.evidenceType, input.storageUrl, input.storageKey, input.mimeType,
      input.originalFilename, input.uploadedBy, input.description],
  );
  if (!created) throw new Error('Incident evidence insert returned no row');
  return mapEvidence(created);
}

export type AcknowledgeIncidentOutcome = 'acknowledged' | 'already_acknowledged' | 'terminal_conflict';
export interface AcknowledgeIncidentResult {
  outcome: AcknowledgeIncidentOutcome; lifecycleStatus: IncidentLifecycleStatus; actionId: string | null;
}

// First acknowledgement wins. A terminal incident (resolved/dismissed) returns `terminal_conflict` and makes no
// mutation — the API layer maps that to 409. An incident already past `open` returns `already_acknowledged`
// idempotently without overwriting the original actor/time or appending a second action.
export async function acknowledgeIncident(
  incidentId: string, actorUserId: string, note: string | null, requestCorrelationId: string | null, txn: TxnClient,
): Promise<AcknowledgeIncidentResult> {
  const current = await txn.queryOne<{ lifecycle_status: IncidentLifecycleStatus; escalation_level: number }>(
    `SELECT lifecycle_status, escalation_level FROM fleet_operational_incidents WHERE id = $1::uuid FOR UPDATE`,
    [incidentId],
  );
  if (!current) throw new IncidentNotFoundError(`No incident found for id ${incidentId}`);
  if (TERMINAL_STATUSES.includes(current.lifecycle_status)) {
    return { outcome: 'terminal_conflict', lifecycleStatus: current.lifecycle_status, actionId: null };
  }
  if (current.lifecycle_status !== 'open') {
    return { outcome: 'already_acknowledged', lifecycleStatus: current.lifecycle_status, actionId: null };
  }
  const updated = await txn.queryOne<{ lifecycle_status: IncidentLifecycleStatus }>(
    `UPDATE fleet_operational_incidents
     SET lifecycle_status = 'acknowledged', acknowledged_by = $2::uuid, acknowledged_at = now(), updated_at = now()
     WHERE id = $1::uuid RETURNING lifecycle_status`,
    [incidentId, actorUserId],
  );
  if (!updated) throw new Error('Incident acknowledgement update returned no row');
  const action = await insertIncidentAction({
    incidentId, actionType: 'acknowledged', actorUserId, isSystemActor: false, note,
    beforeLifecycleStatus: 'open', afterLifecycleStatus: 'acknowledged',
    beforeEscalationLevel: current.escalation_level, afterEscalationLevel: current.escalation_level,
    metadata: {}, requestCorrelationId,
  }, txn);
  return { outcome: 'acknowledged', lifecycleStatus: updated.lifecycle_status, actionId: action.id };
}

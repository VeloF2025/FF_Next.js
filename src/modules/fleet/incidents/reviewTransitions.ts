/**
 * Transaction-scoped lifecycle transitions and bulk acknowledgement for the
 * manager review surface (design §§4, 16). Every mutating path locks the
 * incident row `FOR UPDATE` inside its own transaction, appends exactly one
 * action, and returns whatever `sendResolutionNotification` needs so the
 * caller (`reviewService`) can send it strictly *after* that transaction
 * commits — never from inside it (CLAUDE.md hard constraint).
 *
 * `acknowledged` delegates entirely to `incidentRepository.acknowledgeIncident`
 * (first-ack-wins/idempotent/terminal-conflict already implemented there —
 * reused, not reimplemented). Every other transition is new here: this
 * repository had no `review_started`/`commented`/`resolved`/`dismissed`
 * writers yet.
 */
import { query, transaction, type TxnClient } from '@/lib/db-pool';
import { acknowledgeIncident, insertIncidentAction, IncidentNotFoundError } from './incidentRepository';
import type { ResolutionNotificationInput } from './incidentNotifications';
import type { IncidentLifecycleStatus, IncidentOutcome, IncidentTransitionRequest, IncidentTransitionResult } from './types';
import type { IncidentScopeFilter } from './reviewScope';
import { isProjectOwnedByScope } from './reviewScope';

export class IncidentTransitionValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'IncidentTransitionValidationError'; }
}
export class IncidentTransitionConflictError extends Error {
  constructor(message: string, public readonly lifecycleStatus: IncidentLifecycleStatus) { super(message); this.name = 'IncidentTransitionConflictError'; }
}
export class IncidentTransitionForbiddenError extends Error {
  constructor(message: string) { super(message); this.name = 'IncidentTransitionForbiddenError'; }
}

const TERMINAL: readonly IncidentLifecycleStatus[] = ['resolved', 'dismissed'];

export interface TransitionOutcome { result: IncidentTransitionResult; notify?: ResolutionNotificationInput }

interface LockedRow extends Record<string, unknown> {
  lifecycle_status: IncidentLifecycleStatus; escalation_level: number; incident_reference: string;
  incident_type: string; severity: string; project_id: string | null; staff_name_snapshot: string | null;
  incident_rule_id: string | null;
}

async function lockIncident(incidentId: string, txn: TxnClient): Promise<LockedRow> {
  const row = await txn.queryOne<LockedRow>(
    `SELECT lifecycle_status, escalation_level, incident_reference, incident_type, severity, project_id,
       staff_name_snapshot, incident_rule_id
     FROM fleet_operational_incidents WHERE id = $1::uuid FOR UPDATE`,
    [incidentId],
  );
  if (!row) throw new IncidentNotFoundError(`No incident found for id ${incidentId}`);
  return row;
}

async function priorActionId(incidentId: string, actionType: string, txn: TxnClient): Promise<string> {
  const row = await txn.queryOne<{ id: string }>(
    `SELECT id FROM fleet_operational_incident_actions WHERE incident_id = $1::uuid AND action_type = $2 ORDER BY occurred_at DESC LIMIT 1`,
    [incidentId, actionType],
  );
  return row?.id ?? '';
}

async function runAcknowledged(request: IncidentTransitionRequest, txn: TxnClient): Promise<TransitionOutcome> {
  const ack = await acknowledgeIncident(request.incidentId, request.actorUserId, request.note ?? null, request.requestCorrelationId ?? null, txn);
  if (ack.outcome === 'terminal_conflict') throw new IncidentTransitionConflictError('Incident is already closed', ack.lifecycleStatus);
  if (ack.outcome === 'already_acknowledged') {
    const actionId = await priorActionId(request.incidentId, 'acknowledged', txn);
    return { result: { incidentId: request.incidentId, lifecycleStatus: ack.lifecycleStatus, actionId } };
  }
  return { result: { incidentId: request.incidentId, lifecycleStatus: ack.lifecycleStatus, actionId: ack.actionId ?? '' } };
}

async function runReviewStarted(request: IncidentTransitionRequest, txn: TxnClient): Promise<TransitionOutcome> {
  const current = await lockIncident(request.incidentId, txn);
  if (TERMINAL.includes(current.lifecycle_status)) throw new IncidentTransitionConflictError('Incident is already closed', current.lifecycle_status);
  if (current.lifecycle_status === 'under_review') {
    const actionId = await priorActionId(request.incidentId, 'review_started', txn);
    return { result: { incidentId: request.incidentId, lifecycleStatus: 'under_review', actionId } };
  }
  if (current.lifecycle_status !== 'acknowledged') {
    throw new IncidentTransitionConflictError('Incident must be acknowledged before review can start', current.lifecycle_status);
  }
  await txn.query(
    `UPDATE fleet_operational_incidents SET lifecycle_status = 'under_review', review_started_by = $2::uuid, review_started_at = now(), updated_at = now() WHERE id = $1::uuid`,
    [request.incidentId, request.actorUserId],
  );
  const action = await insertIncidentAction({
    incidentId: request.incidentId, actionType: 'review_started', actorUserId: request.actorUserId, isSystemActor: false,
    note: request.note ?? null, beforeLifecycleStatus: current.lifecycle_status, afterLifecycleStatus: 'under_review',
    beforeEscalationLevel: current.escalation_level, afterEscalationLevel: current.escalation_level,
    metadata: {}, requestCorrelationId: request.requestCorrelationId ?? null,
  }, txn);
  return { result: { incidentId: request.incidentId, lifecycleStatus: 'under_review', actionId: action.id } };
}

async function runCommented(request: IncidentTransitionRequest, txn: TxnClient): Promise<TransitionOutcome> {
  const current = await lockIncident(request.incidentId, txn);
  if (TERMINAL.includes(current.lifecycle_status)) throw new IncidentTransitionConflictError('Incident is already closed', current.lifecycle_status);
  const action = await insertIncidentAction({
    incidentId: request.incidentId, actionType: 'commented', actorUserId: request.actorUserId, isSystemActor: false,
    note: request.note ?? null, beforeLifecycleStatus: current.lifecycle_status, afterLifecycleStatus: current.lifecycle_status,
    beforeEscalationLevel: current.escalation_level, afterEscalationLevel: current.escalation_level,
    metadata: {}, requestCorrelationId: request.requestCorrelationId ?? null,
  }, txn);
  return { result: { incidentId: request.incidentId, lifecycleStatus: current.lifecycle_status, actionId: action.id } };
}

async function loadRuleEvidenceRequirement(ruleId: string | null, txn: TxnClient): Promise<IncidentOutcome[]> {
  if (!ruleId) return [];
  const row = await txn.queryOne<{ evidence_required_outcomes: IncidentOutcome[] }>(
    `SELECT evidence_required_outcomes FROM fleet_operational_incident_rules WHERE id = $1::uuid`, [ruleId],
  );
  return row?.evidence_required_outcomes ?? [];
}

async function resolveDuplicateLink(incidentId: string, linkedIncidentReference: string | null, txn: TxnClient): Promise<string | null> {
  if (!linkedIncidentReference) throw new IncidentTransitionValidationError('linkedIncidentReference is required for a duplicate outcome');
  const linked = await txn.queryOne<{ id: string }>(`SELECT id FROM fleet_operational_incidents WHERE incident_reference = $1`, [linkedIncidentReference]);
  if (!linked || linked.id === incidentId) throw new IncidentTransitionValidationError('linkedIncidentReference must reference a different, existing incident');
  return linked.id;
}

async function runTerminal(
  request: IncidentTransitionRequest & { actionType: 'resolved' | 'dismissed' }, txn: TxnClient,
): Promise<TransitionOutcome> {
  const current = await lockIncident(request.incidentId, txn);
  if (current.lifecycle_status !== 'under_review') {
    if (TERMINAL.includes(current.lifecycle_status)) throw new IncidentTransitionConflictError('Incident is already closed', current.lifecycle_status);
    throw new IncidentTransitionConflictError('Incident must be under review before it can be closed', current.lifecycle_status);
  }
  const outcome = request.outcome as IncidentOutcome;
  const duplicateIncidentId = outcome === 'duplicate' ? await resolveDuplicateLink(request.incidentId, request.linkedIncidentReference ?? null, txn) : null;
  const requiredOutcomes = await loadRuleEvidenceRequirement(current.incident_rule_id, txn);
  if (requiredOutcomes.includes(outcome)) {
    const evidenceRow = await txn.queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM fleet_operational_incident_evidence WHERE incident_id = $1::uuid`, [request.incidentId],
    );
    if (!evidenceRow || Number(evidenceRow.count) === 0) throw new IncidentTransitionValidationError(`Outcome ${outcome} requires at least one evidence attachment`);
  }
  const note = request.note ?? '';
  await txn.query(
    `UPDATE fleet_operational_incidents
     SET lifecycle_status = $2, resolved_by = $3::uuid, resolved_at = now(), outcome = $4, resolution_note = $5,
         duplicate_incident_id = $6::uuid, updated_at = now()
     WHERE id = $1::uuid`,
    [request.incidentId, request.actionType, request.actorUserId, outcome, note, duplicateIncidentId],
  );
  const action = await insertIncidentAction({
    incidentId: request.incidentId, actionType: request.actionType, actorUserId: request.actorUserId, isSystemActor: false, note,
    beforeLifecycleStatus: current.lifecycle_status, afterLifecycleStatus: request.actionType,
    beforeEscalationLevel: current.escalation_level, afterEscalationLevel: current.escalation_level,
    metadata: outcome === 'duplicate' ? { duplicateIncidentReference: request.linkedIncidentReference ?? null } : {},
    requestCorrelationId: request.requestCorrelationId ?? null,
  }, txn);
  return {
    result: { incidentId: request.incidentId, lifecycleStatus: request.actionType, actionId: action.id },
    notify: {
      incidentId: request.incidentId, incidentReference: current.incident_reference,
      incidentType: current.incident_type as ResolutionNotificationInput['incidentType'],
      severity: current.severity as ResolutionNotificationInput['severity'], projectId: current.project_id,
      staffName: current.staff_name_snapshot, lifecycleStatus: request.actionType, outcome, resolutionNote: note,
    },
  };
}

export async function runIncidentTransition(request: IncidentTransitionRequest): Promise<TransitionOutcome> {
  return transaction((txn) => {
    switch (request.actionType) {
      case 'acknowledged': return runAcknowledged(request, txn);
      case 'review_started': return runReviewStarted(request, txn);
      case 'commented': return runCommented(request, txn);
      case 'resolved':
      case 'dismissed': return runTerminal(request as IncidentTransitionRequest & { actionType: 'resolved' | 'dismissed' }, txn);
      default: throw new IncidentTransitionValidationError(`Unsupported actionType: ${String(request.actionType)}`);
    }
  });
}

export interface BulkAcknowledgeItemResult { incidentId: string; lifecycleStatus: IncidentLifecycleStatus; actionId: string }
export interface BulkAcknowledgeConflict { incidentId: string; lifecycleStatus: IncidentLifecycleStatus }
export interface BulkAcknowledgeOutcome { results: BulkAcknowledgeItemResult[]; conflicts: BulkAcknowledgeConflict[] }

interface BulkCandidateRow extends Record<string, unknown> { id: string; lifecycle_status: IncidentLifecycleStatus; project_id: string | null }

/**
 * Validates every requested incident (existence, not-already-terminal, and
 * scope) before mutating any (this task's brief). Each acknowledgement then
 * still runs in its own row-locked transaction — bulk is a validated batch
 * of independent acknowledgements, not one giant multi-row transaction.
 */
export async function runBulkAcknowledge(
  incidentIds: string[], actorUserId: string, scope: IncidentScopeFilter, requestCorrelationId: string | null,
): Promise<BulkAcknowledgeOutcome> {
  const rows = await query<BulkCandidateRow>(
    `SELECT id, lifecycle_status, project_id FROM fleet_operational_incidents WHERE id = ANY($1::uuid[])`, [incidentIds],
  );
  const found = new Map(rows.map((row) => [row.id, row]));
  for (const id of incidentIds) {
    const row = found.get(id);
    if (!row) throw new IncidentTransitionValidationError(`Incident ${id} was not found`);
    if (TERMINAL.includes(row.lifecycle_status)) throw new IncidentTransitionConflictError(`Incident ${id} is already closed`, row.lifecycle_status);
    if (!await isProjectOwnedByScope(scope, row.project_id)) throw new IncidentTransitionForbiddenError(`Incident ${id} is not in your scope`);
  }
  const results: BulkAcknowledgeItemResult[] = [];
  const conflicts: BulkAcknowledgeConflict[] = [];
  for (const id of incidentIds) {
    const outcome = await transaction((txn) => acknowledgeIncident(id, actorUserId, null, requestCorrelationId, txn));
    // The validation SELECT above is unlocked, so another manager can still resolve or
    // dismiss this incident between validation and its own row-locked transaction.
    // acknowledgeIncident detects that race and returns terminal_conflict without mutating.
    // Collect it rather than throwing: earlier ids in the batch have already committed, so
    // aborting here would report a partial success as a total failure and leave the manager
    // believing nothing happened while some incidents were in fact acknowledged.
    if (outcome.outcome === 'terminal_conflict') {
      conflicts.push({ incidentId: id, lifecycleStatus: outcome.lifecycleStatus });
      continue;
    }
    results.push({ incidentId: id, lifecycleStatus: outcome.lifecycleStatus, actionId: outcome.actionId ?? '' });
  }
  return { results, conflicts };
}

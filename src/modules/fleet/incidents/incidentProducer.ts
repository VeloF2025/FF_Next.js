/**
 * Transactional deduplication, recurrence, observation, and clearing for
 * Fleet operational incidents.
 *
 * Scheduled detections (`late`, `wrong_site`, `evidence_mismatch`,
 * `left_early`) carry an already-resolved `IncidentRuleReference` — rule
 * selection is `monitorService`'s orchestration job (Task 4), not this
 * module's. Source events carry no rule reference at all (nothing upstream
 * resolves one for them), so this module resolves their effective rule
 * itself via `settingsRepository`.
 *
 * Every mutation for one staff/source-event runs on a single pinned
 * connection inside one transaction (find/lock, create-or-update, observation
 * insert, action insert) — see `fleet/parking/approvalQueries.ts` for the
 * same pattern. Concurrent first-detections race past the `find` step (there
 * is nothing yet to lock) and converge on the active partial unique index /
 * source-event unique index at `createIncident`; that failure is caught via
 * a savepoint and resolved by reloading the row the other transaction just
 * committed, rather than failing the whole run.
 *
 * Never sends notifications — Task 5 delivers, and only after this
 * transaction has committed. Callers use `requiresInitialNotification` to
 * know when that's warranted.
 */
import { log } from '@/lib/logger';
import { transaction, type TxnClient } from '@/lib/db-pool';
import type { OperationalStatus } from '../operations/types';
import {
  type CreateIncidentInput,
  type IncidentRecord,
  clearIncidentCondition,
  createIncident,
  findActiveIncident,
  findIncidentBySourceEvent,
  insertIncidentAction,
  recordObservation,
  touchIncidentLastSeen,
} from './incidentRepository';
import { loadEffectiveIncidentRule } from './settingsRepository';
import { buildAssignmentIdentity, computeObservationFingerprint } from './observationFingerprint';
import type {
  IncidentProducerRequest, IncidentSeverity, IncidentType,
  ScheduledIncidentProducerRequest, ScheduledIncidentType,
} from './types';

export class IncidentProducerValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'IncidentProducerValidationError'; }
}
export class IncidentProducerConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = 'IncidentProducerConfigurationError'; }
}

export type IncidentProducerOutcome = 'opened' | 'updated' | 'cleared' | 'unchanged' | 'ignored';
export interface IncidentProducerRunResult {
  outcome: IncidentProducerOutcome;
  incidentId: string | null;
  requiresInitialNotification: boolean;
}

// `IncidentSourceEvent` alone omits the shared `severity`/`evidenceSnapshot`/`requestCorrelationId`
// override fields declared on the (unexported) `IncidentProducerBase` half of the union member.
type SourceEventProducerRequest = Extract<IncidentProducerRequest, { producerKind: 'source_event' }>;

const SOURCE_EVENT_TYPES: readonly IncidentType[] = [
  'accident_sos', 'dangerous_area_entry', 'theft_after_hours_movement',
  'severe_driving', 'prolonged_unauthorized_stop', 'lost_contact_moving',
];

const SCHEDULED_STATUS_TYPES: Partial<Record<OperationalStatus, ScheduledIncidentType>> = {
  late: 'late', wrong_site: 'wrong_site', evidence_mismatch: 'evidence_mismatch', left_early: 'left_early',
};

/** The only four PR6 statuses that open incidents automatically; every other status (summary-only or normal) maps to null. */
export function resolveScheduledIncidentType(status: OperationalStatus): ScheduledIncidentType | null {
  return SCHEDULED_STATUS_TYPES[status] ?? null;
}

const UNIQUE_VIOLATION_CODE = '23505';
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION_CODE;
}

/** Inserts via a savepoint so a concurrent-create race (no row existed to lock at `find` time) can recover in the same transaction by reloading the winner's row instead of failing the whole run. */
async function createIncidentConvergingOnConflict(
  txn: TxnClient, input: CreateIncidentInput, reload: () => Promise<IncidentRecord | null>,
): Promise<{ record: IncidentRecord; created: boolean }> {
  await txn.query('SAVEPOINT fleet_incident_create');
  try {
    const record = await createIncident(input, txn);
    return { record, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await txn.query('ROLLBACK TO SAVEPOINT fleet_incident_create');
    const existing = await reload();
    if (!existing) throw error;
    log.warn('[fleet-incident-producer] concurrent create converged on existing incident', {
      incidentType: input.incidentType, incidentId: existing.id,
    });
    return { record: existing, created: false };
  }
}

async function insertOpenedAction(incidentId: string, requestCorrelationId: string | null, txn: TxnClient): Promise<void> {
  await insertIncidentAction({
    incidentId, actionType: 'opened', actorUserId: null, isSystemActor: true, note: null,
    beforeLifecycleStatus: null, afterLifecycleStatus: 'open', beforeEscalationLevel: null, afterEscalationLevel: 0,
    metadata: {}, requestCorrelationId,
  }, txn);
}

async function recordScheduledObservation(
  incidentId: string, request: ScheduledIncidentProducerRequest, txn: TxnClient,
): Promise<void> {
  await recordObservation({
    incidentId, observationFingerprint: request.evaluation.observationFingerprint,
    observedAt: request.evaluation.observedAt, primaryStatus: request.evaluation.primaryStatus,
    flags: request.evaluation.flags, ruleId: request.rules.statusRuleId, ruleVersion: request.rules.statusRuleVersion,
    evidenceSnapshot: request.evidenceSnapshot ?? {}, reasonCodes: request.evaluation.reasonCodes,
    monitorRunId: request.monitorRunId ?? null, sourceEventId: null,
  }, txn);
}

/** Recurring detection: the condition is still (or again) present. Touches last-seen — which also clears any stale `condition_cleared_at` (Task 2) — then appends an observation only if its fingerprint materially changed. */
async function applyScheduledRecurrence(
  incidentId: string, request: ScheduledIncidentProducerRequest, txn: TxnClient,
): Promise<void> {
  await touchIncidentLastSeen(incidentId, request.evaluation.observedAt, txn);
  await recordScheduledObservation(incidentId, request, txn);
}

function buildScheduledCreateInput(
  request: ScheduledIncidentProducerRequest, staffId: string, severity: IncidentSeverity,
): CreateIncidentInput {
  const a = request.assignment;
  return {
    incidentType: request.incidentType, severity, staffId, projectId: a.projectId,
    operationalSiteId: a.operationalSiteId, vehicleId: a.vehicleId, operationalAssignmentId: a.operationalAssignmentId,
    workDate: request.workDate, staffNameSnapshot: a.staffNameSnapshot, projectNameSnapshot: a.projectNameSnapshot,
    operationalSiteNameSnapshot: a.operationalSiteNameSnapshot, vehicleRegistrationSnapshot: a.vehicleRegistrationSnapshot,
    sourceEventId: null, statusRuleId: request.rules.statusRuleId, statusRuleVersion: request.rules.statusRuleVersion,
    incidentRuleId: request.rules.incidentRuleId, incidentRuleVersion: request.rules.incidentRuleVersion,
    evidenceSnapshot: request.evidenceSnapshot ?? {}, detectedAt: request.evaluation.observedAt,
    linkedHsReference: null, linkedMaintenanceReference: null,
  };
}

async function produceScheduledIncident(request: ScheduledIncidentProducerRequest): Promise<IncidentProducerRunResult> {
  const staffId = request.assignment.staffId;
  if (!staffId) {
    throw new IncidentProducerValidationError(`A scheduled ${request.incidentType} incident requires a known staff identity`);
  }
  if (request.severity === undefined) {
    throw new IncidentProducerValidationError('severity is required to produce a scheduled incident');
  }
  const severity = request.severity;

  return transaction(async (txn) => {
    const findParams = {
      staffId, incidentType: request.incidentType, workDate: request.workDate,
      operationalAssignmentId: request.assignment.operationalAssignmentId,
    };
    const existing = await findActiveIncident(findParams, txn);
    if (existing) {
      await applyScheduledRecurrence(existing.id, request, txn);
      return { outcome: 'updated' as const, incidentId: existing.id, requiresInitialNotification: false };
    }

    const createInput = buildScheduledCreateInput(request, staffId, severity);
    const { record, created } = await createIncidentConvergingOnConflict(
      txn, createInput, () => findActiveIncident(findParams, txn),
    );
    if (!created) {
      await applyScheduledRecurrence(record.id, request, txn);
      return { outcome: 'updated' as const, incidentId: record.id, requiresInitialNotification: false };
    }

    await insertOpenedAction(record.id, request.requestCorrelationId ?? null, txn);
    await recordScheduledObservation(record.id, request, txn);
    return { outcome: 'opened' as const, incidentId: record.id, requiresInitialNotification: true };
  });
}

async function produceSourceEventIncident(request: SourceEventProducerRequest): Promise<IncidentProducerRunResult> {
  if (!SOURCE_EVENT_TYPES.includes(request.incidentType)) {
    throw new IncidentProducerValidationError(`${request.incidentType} is not a supported source-event incident type`);
  }
  const sourceEventId = request.sourceEventId.trim();
  if (!sourceEventId) throw new IncidentProducerValidationError('sourceEventId is required for source-event incidents');

  const rule = await loadEffectiveIncidentRule(request.incidentType, request.occurredAt);
  if (!rule) throw new IncidentProducerConfigurationError(`No effective incident rule configured for ${request.incidentType}`);
  const severity = request.severity ?? rule.severity;
  const evidenceSnapshot = request.evidenceSnapshot ?? request.metadata;
  const staffId = request.staffId ?? null;
  const vehicleId = request.vehicleId ?? null;
  const operationalAssignmentId = request.operationalAssignmentId ?? null;

  return transaction(async (txn) => {
    const existing = await findIncidentBySourceEvent(request.incidentType, sourceEventId, txn);
    if (existing) return { outcome: 'unchanged' as const, incidentId: existing.id, requiresInitialNotification: false };

    const createInput: CreateIncidentInput = {
      incidentType: request.incidentType, severity, staffId, projectId: request.projectId ?? null,
      operationalSiteId: request.operationalSiteId ?? null, vehicleId, operationalAssignmentId, workDate: null,
      staffNameSnapshot: null, projectNameSnapshot: null, operationalSiteNameSnapshot: null,
      vehicleRegistrationSnapshot: request.vehicleRegistrationSnapshot ?? null,
      sourceEventId, statusRuleId: null, statusRuleVersion: null, incidentRuleId: rule.id, incidentRuleVersion: rule.version,
      evidenceSnapshot, detectedAt: request.occurredAt,
      linkedHsReference: request.linkedHsReference ?? null, linkedMaintenanceReference: request.linkedMaintenanceReference ?? null,
    };
    const { record, created } = await createIncidentConvergingOnConflict(
      txn, createInput, () => findIncidentBySourceEvent(request.incidentType, sourceEventId, txn),
    );
    if (!created) return { outcome: 'unchanged' as const, incidentId: record.id, requiresInitialNotification: false };

    await insertOpenedAction(record.id, request.requestCorrelationId ?? null, txn);
    await recordObservation({
      incidentId: record.id,
      observationFingerprint: computeObservationFingerprint({
        incidentType: request.incidentType, ruleId: rule.id, ruleVersion: rule.version,
        assignmentIdentity: buildAssignmentIdentity(staffId, vehicleId, operationalAssignmentId),
        reasonCodes: [], freshnessBucket: null, siteId: request.operationalSiteId ?? null,
        projectId: request.projectId ?? null, vehicleId, conditionActive: true,
      }),
      observedAt: request.occurredAt, primaryStatus: request.incidentType, flags: [],
      // `observations.rule_id` is an FK to `fleet_operational_status_rules` (migration
      // 510) — the roster STATUS rule the scheduled path resolves. A source event has
      // no status rule; `rule` here is an `fleet_operational_incident_rules` row, and
      // writing its id here violated that FK on every real source event. Null/null is
      // the honest value (and satisfies the rule_pair CHECK): the incident row itself
      // still records `incident_rule_id`/`incident_rule_version`, so nothing is lost.
      // The fingerprint above deliberately keeps the incident rule identity, so dedup
      // semantics are unchanged by this.
      ruleId: null, ruleVersion: null, evidenceSnapshot, reasonCodes: [],
      monitorRunId: null, sourceEventId,
    }, txn);
    return { outcome: 'opened' as const, incidentId: record.id, requiresInitialNotification: true };
  });
}

export async function produceIncident(request: IncidentProducerRequest): Promise<IncidentProducerRunResult> {
  if (request.producerKind === 'source_event') return produceSourceEventIncident(request);
  return produceScheduledIncident(request);
}

export interface ConditionClearingRequest {
  staffId: string;
  incidentType: ScheduledIncidentType;
  workDate: string;
  operationalAssignmentId: string | null;
  observedAt: string;
  /** True only under healthy, current evidence. Missing/stale/unhealthy evidence must never prove clearing (design §8.3). */
  evidenceHealthy: boolean;
  requestCorrelationId?: string | null;
}

/** Marks a still-active incident's condition cleared when this cycle's evidence is healthy and shows the condition absent. Never resolves/dismisses the incident, and is a no-op (not an error) when there is no active incident, evidence is unhealthy, or it was already cleared. */
export async function evaluateConditionClearing(request: ConditionClearingRequest): Promise<IncidentProducerRunResult> {
  return transaction(async (txn) => {
    const active = await findActiveIncident({
      staffId: request.staffId, incidentType: request.incidentType, workDate: request.workDate,
      operationalAssignmentId: request.operationalAssignmentId,
    }, txn);
    if (!active) return { outcome: 'unchanged' as const, incidentId: null, requiresInitialNotification: false };
    if (!request.evidenceHealthy || active.conditionClearedAt !== null) {
      return { outcome: 'unchanged' as const, incidentId: active.id, requiresInitialNotification: false };
    }

    await clearIncidentCondition(active.id, request.observedAt, txn);
    await insertIncidentAction({
      incidentId: active.id, actionType: 'condition_cleared', actorUserId: null, isSystemActor: true, note: null,
      beforeLifecycleStatus: active.lifecycleStatus, afterLifecycleStatus: active.lifecycleStatus,
      beforeEscalationLevel: active.escalationLevel, afterEscalationLevel: active.escalationLevel,
      metadata: {}, requestCorrelationId: request.requestCorrelationId ?? null,
    }, txn);
    return { outcome: 'cleared' as const, incidentId: active.id, requiresInitialNotification: false };
  });
}

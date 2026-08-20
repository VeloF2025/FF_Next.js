/**
 * Manager request-driver-input transaction (design §§6, 7, 11.1, 16).
 * Mirrors `../reviewService.ts`'s two-phase shape: an unlocked scope/
 * ownership check against `../reviewQueries.getIncidentCore` first (fast,
 * correct 403/404), then a single row-locked transaction that revalidates
 * and mutates. Notification fires strictly *after* that transaction has
 * committed — never from inside it (CLAUDE.md hard rule; this task's
 * locked notification rule #1).
 *
 * `IncidentAccessDeniedError` is intentionally NOT reused from
 * `../reviewService.ts` here: importing that module would pull in its
 * full manager-transition dependency graph for the sake of one error
 * class. This module defines its own `DriverInputAccessDeniedError`
 * instead; only `IncidentNotFoundError` (a plain, dependency-free class in
 * `../incidentRepository.ts`) is reused, since duplicating a 404 shape
 * would be pure waste.
 *
 * Re-request handling ("supersede"): `insertInputRequest` is idempotent on
 * `(incident_id, idempotency_key)` (`./driverInputWriteRepository.ts`). A
 * genuinely new request (`created: true`) supersedes every other still-open
 * request for the incident and appends one `shared_with_driver` guidance
 * action; a retried duplicate (`created: false`, same idempotency key)
 * does neither — the exact same request row is simply returned again, and
 * a driver already notified for its `inputRequestId` cannot be re-notified
 * because `notify()` claims `(driverUserId, event_type, idempotency_key)`
 * before dispatching (`./driverNotifications.ts`).
 *
 * Delivery outcome (`delivery_attempted_count`/`_accepted_count`/
 * `_failed_count` — migration 511) is persisted after every notify
 * attempt, including retries: each call is one attempt, `accepted`/
 * `failed` increment only when `notify()` actually reports that outcome
 * for this attempt. That persistence write runs after commit, outside the
 * incident transaction, and never throws into the caller — a manager who
 * successfully requested input must not see a 500 because a delivery
 * counter failed to update.
 *
 * Response-window `scheduledWeekdays`: this task could not find a
 * migration in this worktree defining the `attendance_policies`/
 * `attendance_policy_assignments` tables that
 * `fleet/operations/evidenceQueries.ts` already reads from (no
 * `CREATE TABLE` for either name appears anywhere under
 * `scripts/migrations/sql/`), so querying them here would be an
 * unverifiable schema guess — exactly the trap this task was warned
 * about ("unit tests mock the database, so a schema mismatch will not be
 * caught"). `scheduledWeekdays` is passed as `null`, which
 * `./inputState.ts#calculateRespondBy` already treats as "no schedule
 * rows" and falls back to Monday-Friday, matching design §6's own
 * documented fallback. Wiring the real per-driver schedule is left as a
 * follow-up once that table's migration is confirmed.
 */
import { query, queryOne, transaction, type TxnClient } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import type { NotifyResult } from '@/modules/notifications/types';
import { isValidUUID } from '../../services/mileageUtils';
import { parseStrictIsoInstant } from '../../operations/instantValidation';
import { IncidentNotFoundError } from '../incidentRepository';
import { isProjectOwnedByScope, resolveIncidentScope } from '../reviewScope';
import { getIncidentCore } from '../reviewQueries';
import { SELF_REVIEW_REFUSAL_MESSAGE, isIncidentSubject } from '../selfReviewGuard';
import { neutralIncidentLabel } from './driverInputRepository';
import { insertInputRequest } from './driverInputWriteRepository';
import { notifyDriverInputRequested } from './driverNotifications';
import { deriveDriverInputState, calculateRespondBy } from './inputState';
import { getEffectiveDriverInputSettings } from './settingsRepository';
import type { DriverInputRequestResult, RequestDriverInputCommand } from './types';

const MODULE = 'FleetRequestDriverInput';
const DAY_MS = 24 * 60 * 60 * 1000;

export class DriverInputRequestValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'DriverInputRequestValidationError'; }
}
export class DriverInputAccessDeniedError extends Error {
  constructor(message = 'You cannot act on this Fleet incident') { super(message); this.name = 'DriverInputAccessDeniedError'; }
}
export class DriverInputRequestConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'DriverInputRequestConflictError'; }
}

export interface DriverInputActorScope { userId: string; staffId: string | null; role: string }

function normalizeGuidance(guidance: string | null | undefined): string | null {
  if (typeof guidance !== 'string') return null;
  const trimmed = guidance.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validateCustomRespondBy(value: string, nowMs: number): string {
  const parsedMs = parseStrictIsoInstant(value);
  if (parsedMs === null) throw new DriverInputRequestValidationError('respondBy must be a valid ISO instant');
  if (parsedMs <= nowMs) throw new DriverInputRequestValidationError('respondBy must be in the future');
  return new Date(parsedMs).toISOString();
}

interface LockedIncidentRow extends Record<string, unknown> { staff_id: string | null; lifecycle_status: string; resolved_at: string | Date | null }
interface LockedIncident { staffId: string | null; lifecycleStatus: string; resolvedAt: string | null }

async function lockIncidentForRequest(incidentId: string, txn: TxnClient): Promise<LockedIncident | null> {
  const row = await txn.queryOne<LockedIncidentRow>(
    `SELECT staff_id, lifecycle_status, resolved_at FROM fleet_operational_incidents WHERE id = $1::uuid FOR UPDATE`,
    [incidentId],
  );
  if (!row) return null;
  const resolvedAt = row.resolved_at === null ? null : (row.resolved_at instanceof Date ? row.resolved_at.toISOString() : row.resolved_at);
  return { staffId: row.staff_id, lifecycleStatus: row.lifecycle_status, resolvedAt };
}

function assertWithinPostClosurePolicy(
  resolvedAt: string | null, nowMs: number, postClosureResponseEnabled: boolean, postClosureResponseWindowDays: number,
): void {
  if (resolvedAt === null) return;
  if (!postClosureResponseEnabled) {
    throw new DriverInputRequestConflictError('Incident is closed and driver input can no longer be requested');
  }
  const deadlineMs = new Date(resolvedAt).getTime() + postClosureResponseWindowDays * DAY_MS;
  if (nowMs > deadlineMs) throw new DriverInputRequestConflictError('The post-closure driver-input window has passed');
}

async function resolveDriverUserId(staffId: string): Promise<string | null> {
  // The bus addresses users; a driver is staff. staff.user_id is nullable — see
  // ../../parking/decisionNotifications.ts for the same precedent.
  const row = await queryOne<{ user_id: string | null }>(`SELECT user_id FROM staff WHERE id = $1::uuid LIMIT 1`, [staffId]);
  return row?.user_id ?? null;
}

async function recordDeliveryOutcome(requestId: string, result: NotifyResult): Promise<void> {
  try {
    await query(
      `UPDATE fleet_incident_driver_input_requests
       SET delivery_attempted_count = delivery_attempted_count + 1,
           delivery_accepted_count = delivery_accepted_count + $2,
           delivery_failed_count = delivery_failed_count + $3
       WHERE id = $1::uuid`,
      [requestId, result.delivered > 0 ? 1 : 0, result.failed > 0 ? 1 : 0],
    );
  } catch (error) {
    log.error('[fleet-driver-input] failed to persist delivery outcome onto the request row', {
      requestId, error: error instanceof Error ? error.message : String(error),
    }, MODULE);
  }
}

interface TransactionOutcome { requestId: string; guidance: string | null; requestedAt: string; respondBy: string }

async function runRequestTransaction(
  command: RequestDriverInputCommand, actorUserId: string, guidance: string | null, respondBy: string,
  settings: { postClosureResponseEnabled: boolean; postClosureResponseWindowDays: number },
): Promise<TransactionOutcome> {
  return transaction(async (txn) => {
    const locked = await lockIncidentForRequest(command.incidentId, txn);
    if (!locked) throw new IncidentNotFoundError(`No incident found for id ${command.incidentId}`);
    if (!locked.staffId) throw new DriverInputRequestValidationError('Incident has no linked driver to request input from');
    assertWithinPostClosurePolicy(locked.resolvedAt, Date.now(), settings.postClosureResponseEnabled, settings.postClosureResponseWindowDays);

    const insertResult = await insertInputRequest(
      { incidentId: command.incidentId, requestedBy: actorUserId, guidance, respondBy, idempotencyKey: command.idempotencyKey }, txn,
    );

    if (insertResult.created) {
      await txn.query(
        `UPDATE fleet_incident_driver_input_requests SET superseded_at = $2::timestamptz
         WHERE incident_id = $1::uuid AND id <> $3::uuid AND superseded_at IS NULL`,
        [command.incidentId, insertResult.record.requestedAt, insertResult.record.id],
      );
      await txn.query(
        `INSERT INTO fleet_operational_incident_actions
          (incident_id, action_type, actor_user_id, is_system_actor, note, visibility,
           before_lifecycle_status, after_lifecycle_status, before_escalation_level, after_escalation_level, metadata)
         VALUES ($1::uuid, 'driver_input_requested', $2::uuid, false, $3, 'shared_with_driver', $4, $4, 0, 0, '{}'::jsonb)`,
        [command.incidentId, actorUserId, guidance, locked.lifecycleStatus],
      );
    }

    return {
      requestId: insertResult.record.id, guidance: insertResult.record.guidance,
      requestedAt: insertResult.record.requestedAt, respondBy: insertResult.record.respondBy,
    };
  });
}

/**
 * Requests optional driver input on an incident. Notifies the driver only
 * after this function's own transaction has committed (locked rule #1);
 * a notification failure is recorded in the returned result, never thrown.
 */
export async function requestDriverInput(
  command: RequestDriverInputCommand, actorScope: DriverInputActorScope,
): Promise<DriverInputRequestResult> {
  if (!isValidUUID(command.incidentId)) throw new DriverInputRequestValidationError('incidentId must be a valid UUID');
  if (typeof command.idempotencyKey !== 'string' || command.idempotencyKey.trim().length === 0) {
    throw new DriverInputRequestValidationError('idempotencyKey is required');
  }
  const guidance = normalizeGuidance(command.guidance);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const customRespondBy = command.respondBy ? validateCustomRespondBy(command.respondBy, nowMs) : null;

  const scope = await resolveIncidentScope(actorScope.userId, actorScope.staffId, actorScope.role, 'edit');
  if (!scope) throw new DriverInputAccessDeniedError('You cannot act on Fleet incidents');

  const core = await getIncidentCore(command.incidentId);
  if (!core) throw new IncidentNotFoundError(`No incident found for id ${command.incidentId}`);
  if (!scope.unrestricted && !(await isProjectOwnedByScope(scope, core.projectId))) {
    throw new DriverInputAccessDeniedError('You cannot act on this Fleet incident');
  }
  if (!core.staffId) throw new DriverInputRequestValidationError('Incident has no linked driver to request input from');
  // A manager must not demand an explanation from themselves. Independent of scope: an
  // oversight member is no more entitled to do that than a PM is (../selfReviewGuard.ts).
  if (isIncidentSubject(scope.pmStaffId, core.staffId)) throw new DriverInputAccessDeniedError(SELF_REVIEW_REFUSAL_MESSAGE);

  const settings = await getEffectiveDriverInputSettings(nowIso);
  const respondBy = customRespondBy ?? calculateRespondBy({
    requestedAt: nowIso, responseWindowWorkdays: settings.responseWindowWorkdays, scheduledWeekdays: null,
  }).toISOString();

  const outcome = await runRequestTransaction(command, actorScope.userId, guidance, respondBy, settings);

  const driverUserId = await resolveDriverUserId(core.staffId);
  const notification = await notifyDriverInputRequested(
    { inputRequestId: outcome.requestId, guidance: outcome.guidance, respondBy: outcome.respondBy },
    {
      incidentId: command.incidentId, incidentReference: core.incidentReference, neutralLabel: neutralIncidentLabel(core.incidentType),
      projectLabel: core.projectName, siteLabel: core.operationalSiteName,
    },
    driverUserId,
  );
  await recordDeliveryOutcome(outcome.requestId, notification);

  const driverInputState = deriveDriverInputState({
    now: nowIso, currentRequest: { requestedAt: outcome.requestedAt, respondBy: outcome.respondBy },
    respondedAt: null, incidentTerminalAt: core.resolvedAt,
    postClosureResponseEnabled: settings.postClosureResponseEnabled, postClosureResponseWindowDays: settings.postClosureResponseWindowDays,
  });

  return { inputRequestId: outcome.requestId, incidentId: command.incidentId, respondBy: outcome.respondBy, driverInputState, notification };
}

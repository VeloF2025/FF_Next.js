/**
 * Scoped create/review/extend/release commands for retention holds.
 *
 * Two separate authorisations are required for every mutation, and neither
 * substitutes for the other:
 *
 *   1. `fleet.retention-holds` (create/edit). Placing a hold is a decision to
 *      keep a named person's disciplinary record beyond the standard period,
 *      so migration 518 grants it to admin/super_admin only — deliberately not
 *      to project managers.
 *   2. The actor's ordinary `fleet.incidents` scope over the incident itself,
 *      so hold authority never becomes a side door into another project's
 *      incidents.
 *
 * Reading is the weaker check: a scoped viewer sees holds on an incident they
 * can already see, and `canManage` tells the UI whether to offer the controls.
 *
 * Nothing here deletes. A missed review alerts (see `retentionNotifications`);
 * it never auto-releases, and a released hold stays on the record until the
 * incident itself is purged.
 */
import { transaction, type TxnClient } from '@/lib/db-pool';
import { userHasPermission } from '@/lib/permissions';
import { parseStrictIsoInstant } from '../../operations/instantValidation';
import { isValidUUID } from '../../services/mileageUtils';
import { getEffectiveAnalyticsRetentionSettings } from '../analytics/settingsRepository';
import type {
  CreateRetentionHoldCommand, ReleaseRetentionHoldCommand, RetentionHold, RetentionHoldAction,
  RetentionPolicy, ReviewRetentionHoldCommand,
} from '../analytics/types';
import { IncidentNotFoundError } from '../incidentRepository';
import { getIncidentCore } from '../reviewQueries';
import { isActiveFibreFlowUser, isProjectOwnedByScope, resolveIncidentScope } from '../reviewScope';
import {
  FLEET_RETENTION_HOLDS_PERMISSION, insertHold, insertHoldAction, listHoldActions, listIncidentHolds,
  lockHold, recordHoldRelease, recordHoldReview,
} from './holdRepository';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT_LENGTH = 2000;

export class RetentionHoldValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'RetentionHoldValidationError'; }
}
export class RetentionHoldAccessDeniedError extends Error {
  constructor(message: string) { super(message); this.name = 'RetentionHoldAccessDeniedError'; }
}
export class RetentionHoldConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'RetentionHoldConflictError'; }
}

export interface RetentionHoldActorScope {
  userId: string;
  staffId: string | null;
  role: string;
}

function pgErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

function requiredText(value: string, field: string): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) throw new RetentionHoldValidationError(`${field} is required`);
  if (trimmed.length > MAX_TEXT_LENGTH) throw new RetentionHoldValidationError(`${field} is too long`);
  return trimmed;
}

/**
 * The review date must be in the future and no further out than the effective
 * maximum. Both ends matter: a past date is an immediately-overdue hold nobody
 * asked for, and an unbounded one is a permanent record by omission.
 */
function validateReviewInstant(nextReviewAt: string, from: string, policy: RetentionPolicy): string {
  const reviewMs = parseStrictIsoInstant(nextReviewAt);
  if (reviewMs === null) throw new RetentionHoldValidationError('nextReviewAt must be a valid ISO instant');
  const fromMs = parseStrictIsoInstant(from);
  if (fromMs === null) throw new RetentionHoldValidationError('The review baseline instant is invalid');
  if (reviewMs <= fromMs) throw new RetentionHoldValidationError('nextReviewAt must be in the future');
  if (reviewMs > fromMs + policy.maximumHoldReviewDays * DAY_MS) {
    throw new RetentionHoldValidationError(
      `nextReviewAt must be within ${policy.maximumHoldReviewDays} days — an unreviewed hold cannot become permanent`,
    );
  }
  return new Date(reviewMs).toISOString();
}

async function assertHoldAuthority(actor: RetentionHoldActorScope, action: 'create' | 'edit'): Promise<void> {
  if (!await userHasPermission(actor.userId, FLEET_RETENTION_HOLDS_PERMISSION, action)) {
    throw new RetentionHoldAccessDeniedError('Retention holds require explicit hold-management permission');
  }
}

/** Resolves the incident and proves the actor may see it. Throws 404 for a missing incident, 403 for one outside scope. */
async function assertIncidentInScope(incidentId: string, actor: RetentionHoldActorScope): Promise<{ projectId: string | null; incidentReference: string }> {
  if (!isValidUUID(incidentId)) throw new RetentionHoldValidationError('A valid incidentId is required');
  const scope = await resolveIncidentScope(actor.userId, actor.staffId, actor.role, 'view');
  if (!scope) throw new RetentionHoldAccessDeniedError('Fleet incident access is required');
  const incident = await getIncidentCore(incidentId);
  if (!incident) throw new IncidentNotFoundError(`Incident ${incidentId} was not found`);
  if (!await isProjectOwnedByScope(scope, incident.projectId)) {
    throw new RetentionHoldAccessDeniedError('This incident is outside your project scope');
  }
  return { projectId: incident.projectId, incidentReference: incident.incidentReference };
}

export async function createRetentionHold(
  command: CreateRetentionHoldCommand, actor: RetentionHoldActorScope, at: string,
): Promise<RetentionHold> {
  await assertHoldAuthority(actor, 'create');
  await assertIncidentInScope(command.incidentId, actor);

  const policy = await getEffectiveAnalyticsRetentionSettings(at);
  if (!policy.permittedHoldCategories.includes(command.category)) {
    throw new RetentionHoldValidationError(`Hold category ${command.category} is not permitted by the effective settings`);
  }
  const reason = requiredText(command.reason, 'reason');
  if (!isValidUUID(command.ownerUserId)) throw new RetentionHoldValidationError('A valid ownerUserId is required');
  if (!await isActiveFibreFlowUser(command.ownerUserId)) {
    throw new RetentionHoldValidationError('The hold owner must be an active FibreFlow user');
  }
  const nextReviewAt = validateReviewInstant(command.nextReviewAt, at, policy);

  try {
    return await transaction(async (txn: TxnClient) => {
      const hold = await insertHold(txn, {
        incidentId: command.incidentId, category: command.category, reason,
        ownerUserId: command.ownerUserId, createdBy: actor.userId, nextReviewAt,
      });
      await insertHoldAction(txn, {
        holdId: hold.id, actionType: 'created', actorUserId: actor.userId, note: reason,
        previousNextReviewAt: null, newNextReviewAt: nextReviewAt, occurredAt: at,
      });
      return hold;
    });
  } catch (error) {
    const code = pgErrorCode(error);
    // The partial unique index is the concurrency backstop for "one active
    // hold per incident and category" — two managers racing get a conflict,
    // not a duplicate.
    if (code === '23505') {
      throw new RetentionHoldConflictError(`An active ${command.category} hold already exists for this incident`);
    }
    if (code === '23503') throw new IncidentNotFoundError(`Incident ${command.incidentId} was not found`);
    throw error;
  }
}

/**
 * Locks the hold, proves the caller reached it through its OWN incident, and
 * proves scope over that incident.
 *
 * `pathIncidentId` is the `[incidentId]` segment the route was called on.
 * Scope is enforced against the hold's real incident either way, so a mismatch
 * is not a privilege hole — but a route that ignores half its own path is a
 * trap, and a hold id must not be actionable through an unrelated incident's
 * URL.
 */
async function lockActiveHold(
  txn: TxnClient, holdId: string, actor: RetentionHoldActorScope, pathIncidentId?: string,
): Promise<RetentionHold> {
  if (!isValidUUID(holdId)) throw new RetentionHoldValidationError('A valid holdId is required');
  const hold = await lockHold(txn, holdId);
  if (!hold) throw new IncidentNotFoundError(`Retention hold ${holdId} was not found`);
  if (pathIncidentId !== undefined && pathIncidentId !== hold.incidentId) {
    throw new IncidentNotFoundError(`Retention hold ${holdId} does not belong to incident ${pathIncidentId}`);
  }
  await assertIncidentInScope(hold.incidentId, actor);
  if (hold.status !== 'active') {
    throw new RetentionHoldConflictError('This hold has already been released');
  }
  return hold;
}

export async function reviewRetentionHold(
  command: ReviewRetentionHoldCommand, actor: RetentionHoldActorScope, at: string,
): Promise<RetentionHold> {
  await assertHoldAuthority(actor, 'edit');
  const policy = await getEffectiveAnalyticsRetentionSettings(at);
  const note = requiredText(command.note, 'note');
  const nextReviewAt = validateReviewInstant(command.nextReviewAt, at, policy);

  return transaction(async (txn: TxnClient) => {
    const hold = await lockActiveHold(txn, command.holdId, actor, command.incidentId);
    const updated = await recordHoldReview(txn, {
      holdId: hold.id, actorUserId: actor.userId, nextReviewAt, at,
    });
    await insertHoldAction(txn, {
      holdId: hold.id,
      // An extension is a materially different decision from a review that
      // leaves the date where it was, and the history says which happened.
      actionType: new Date(nextReviewAt).getTime() > new Date(hold.nextReviewAt).getTime() ? 'extended' : 'reviewed',
      actorUserId: actor.userId, note,
      previousNextReviewAt: hold.nextReviewAt, newNextReviewAt: nextReviewAt, occurredAt: at,
    });
    return updated;
  });
}

export async function releaseRetentionHold(
  command: ReleaseRetentionHoldCommand, actor: RetentionHoldActorScope, at: string,
): Promise<RetentionHold> {
  await assertHoldAuthority(actor, 'edit');
  const releaseReason = requiredText(command.releaseReason, 'releaseReason');

  return transaction(async (txn: TxnClient) => {
    const hold = await lockActiveHold(txn, command.holdId, actor, command.incidentId);
    const released = await recordHoldRelease(txn, {
      holdId: hold.id, actorUserId: actor.userId, releaseReason, at,
    });
    await insertHoldAction(txn, {
      holdId: hold.id, actionType: 'released', actorUserId: actor.userId, note: releaseReason,
      previousNextReviewAt: hold.nextReviewAt, newNextReviewAt: null, occurredAt: at,
    });
    return released;
  });
}

export interface IncidentHoldsView {
  holds: RetentionHold[];
  actions: RetentionHoldAction[];
  /** False for a scoped viewer without `edit` authority — they see the badge, not the review/release controls. */
  canManage: boolean;
  /**
   * False for a viewer without `create` authority. Kept separate from
   * `canManage` because `createRetentionHold` checks `create` while review and
   * release check `edit`: a grant of one and not the other is expressible, so
   * collapsing them into a single flag offers a Place-hold button whose
   * request the server then refuses.
   */
  canCreate: boolean;
}

export async function listIncidentHoldsForViewer(
  incidentId: string, actor: RetentionHoldActorScope,
): Promise<IncidentHoldsView> {
  await assertIncidentInScope(incidentId, actor);
  const holds = await listIncidentHolds(incidentId);
  const actionLists = await Promise.all(holds.map((hold) => listHoldActions(hold.id)));
  const [canManage, canCreate] = await Promise.all([
    userHasPermission(actor.userId, FLEET_RETENTION_HOLDS_PERMISSION, 'edit'),
    userHasPermission(actor.userId, FLEET_RETENTION_HOLDS_PERMISSION, 'create'),
  ]);
  return { holds, actions: actionLists.flat(), canManage, canCreate };
}

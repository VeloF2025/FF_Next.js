/**
 * Persistence for retention holds and their append-only history
 * (`fleet_incident_retention_holds` / `_hold_actions`, migration 518).
 *
 * Thin on purpose: every authorisation and validation decision lives in
 * `holdService.ts`, and every invariant that must survive a caller that skips
 * the service — one active hold per incident/category, the 90-day review
 * ceiling, append-only history — lives in the schema. This module is the SQL
 * between them, and `tests/migrations/518_fleet_retention_holds.test.ts`
 * executes all of it against a real Postgres.
 *
 * Mutations take a `TxnClient` rather than opening their own transaction: a
 * hold change and the action row that records it are one atomic fact, and a
 * history entry without its state change (or the reverse) would be a lie about
 * a decision to keep a named person's data.
 */
import { query, type TxnClient } from '@/lib/db-pool';
import type {
  RetentionHold, RetentionHoldAction, RetentionHoldActionType, RetentionHoldCategory, RetentionHoldStatus,
} from '../analytics/types';

export const FLEET_RETENTION_HOLDS_PERMISSION = 'fleet.retention-holds';

const HOLD_COLUMNS = `id, incident_id, category, status, reason, owner_user_id, hold_start_at,
  next_review_at, last_reviewed_at, released_at`;
const ACTION_COLUMNS = `id, hold_id, action_type, actor_user_id, occurred_at, note,
  previous_next_review_at, new_next_review_at`;

interface HoldRow extends Record<string, unknown> {
  id: string; incident_id: string; category: RetentionHoldCategory; status: RetentionHoldStatus;
  reason: string; owner_user_id: string; hold_start_at: string | Date; next_review_at: string | Date;
  last_reviewed_at: string | Date | null; released_at: string | Date | null;
}

interface ActionRow extends Record<string, unknown> {
  id: string; hold_id: string; action_type: RetentionHoldActionType; actor_user_id: string;
  occurred_at: string | Date; note: string | null;
  previous_next_review_at: string | Date | null; new_next_review_at: string | Date | null;
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function isoOrNull(value: string | Date | null): string | null {
  return value === null ? null : iso(value);
}

function mapHold(row: HoldRow): RetentionHold {
  return {
    id: row.id, incidentId: row.incident_id, category: row.category, status: row.status,
    reason: row.reason, ownerUserId: row.owner_user_id, holdStartAt: iso(row.hold_start_at),
    nextReviewAt: iso(row.next_review_at), lastReviewedAt: isoOrNull(row.last_reviewed_at),
    releasedAt: isoOrNull(row.released_at),
  };
}

function mapAction(row: ActionRow): RetentionHoldAction {
  return {
    id: row.id, holdId: row.hold_id, actionType: row.action_type, actorUserId: row.actor_user_id,
    occurredAt: iso(row.occurred_at), note: row.note,
    previousNextReviewAt: isoOrNull(row.previous_next_review_at),
    newNextReviewAt: isoOrNull(row.new_next_review_at),
  };
}

/** Every hold on an incident, released ones included — a released hold stays visible until the incident itself is purged. */
export async function listIncidentHolds(incidentId: string): Promise<RetentionHold[]> {
  const rows = await query<HoldRow>(
    `/* fleet-retention-holds:list */
     SELECT ${HOLD_COLUMNS} FROM fleet_incident_retention_holds
     WHERE incident_id = $1::uuid
     ORDER BY (status = 'active') DESC, hold_start_at DESC`,
    [incidentId],
  );
  return rows.map(mapHold);
}

export async function listHoldActions(holdId: string): Promise<RetentionHoldAction[]> {
  const rows = await query<ActionRow>(
    `/* fleet-retention-holds:actions */
     SELECT ${ACTION_COLUMNS} FROM fleet_incident_retention_hold_actions
     WHERE hold_id = $1::uuid ORDER BY occurred_at ASC, id ASC`,
    [holdId],
  );
  return rows.map(mapAction);
}

/**
 * Takes the row lock for a review or release.
 *
 * This is NOT the purge/hold race — that one is already closed by the hold's
 * foreign key to the incident, which takes an implicit FOR KEY SHARE lock that
 * a concurrent DELETE conflicts with (see migration 518's invariant 2). This
 * lock exists for a different reason: reviewing and releasing are both
 * read-modify-write on the same hold row, and without it a review committed
 * against a snapshot taken before a concurrent release would resurrect the
 * hold's review date on an already-released hold.
 */
export async function lockHold(txn: TxnClient, holdId: string): Promise<RetentionHold | null> {
  const row = await txn.queryOne<HoldRow>(
    `/* fleet-retention-holds:lock */
     SELECT ${HOLD_COLUMNS} FROM fleet_incident_retention_holds WHERE id = $1::uuid FOR UPDATE`,
    [holdId],
  );
  return row ? mapHold(row) : null;
}

export interface InsertHoldParams {
  incidentId: string; category: RetentionHoldCategory; reason: string;
  ownerUserId: string; createdBy: string; nextReviewAt: string;
}

export async function insertHold(txn: TxnClient, params: InsertHoldParams): Promise<RetentionHold> {
  const row = await txn.queryOne<HoldRow>(
    `/* fleet-retention-holds:insert */
     INSERT INTO fleet_incident_retention_holds
       (incident_id, category, reason, owner_user_id, created_by, next_review_at)
     VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid, $6::timestamptz)
     RETURNING ${HOLD_COLUMNS}`,
    [params.incidentId, params.category, params.reason, params.ownerUserId, params.createdBy, params.nextReviewAt],
  );
  if (!row) throw new Error('Retention hold insert returned no row');
  return mapHold(row);
}

export interface RecordHoldReviewParams {
  holdId: string; actorUserId: string; nextReviewAt: string; at: string;
}

/** `status = 'active'` in the WHERE clause, not only in the service: a review must never land on a released hold. */
export async function recordHoldReview(txn: TxnClient, params: RecordHoldReviewParams): Promise<RetentionHold> {
  const row = await txn.queryOne<HoldRow>(
    `/* fleet-retention-holds:review */
     UPDATE fleet_incident_retention_holds
        SET last_reviewed_at = $3::timestamptz, last_reviewed_by = $2::uuid,
            next_review_at = $4::timestamptz, updated_at = now()
      WHERE id = $1::uuid AND status = 'active'
      RETURNING ${HOLD_COLUMNS}`,
    [params.holdId, params.actorUserId, params.at, params.nextReviewAt],
  );
  if (!row) throw new Error(`Retention hold ${params.holdId} is not active`);
  return mapHold(row);
}

export interface RecordHoldReleaseParams {
  holdId: string; actorUserId: string; releaseReason: string; at: string;
}

export async function recordHoldRelease(txn: TxnClient, params: RecordHoldReleaseParams): Promise<RetentionHold> {
  const row = await txn.queryOne<HoldRow>(
    `/* fleet-retention-holds:release */
     UPDATE fleet_incident_retention_holds
        SET status = 'released', released_at = $3::timestamptz, released_by = $2::uuid,
            release_reason = $4, updated_at = now()
      WHERE id = $1::uuid AND status = 'active'
      RETURNING ${HOLD_COLUMNS}`,
    [params.holdId, params.actorUserId, params.at, params.releaseReason],
  );
  if (!row) throw new Error(`Retention hold ${params.holdId} is not active`);
  return mapHold(row);
}

export interface InsertHoldActionParams {
  holdId: string; actionType: RetentionHoldActionType; actorUserId: string;
  note: string | null; previousNextReviewAt: string | null; newNextReviewAt: string | null;
  occurredAt?: string;
}

export async function insertHoldAction(txn: TxnClient, params: InsertHoldActionParams): Promise<RetentionHoldAction> {
  const row = await txn.queryOne<ActionRow>(
    `/* fleet-retention-holds:append-action */
     INSERT INTO fleet_incident_retention_hold_actions
       (hold_id, action_type, actor_user_id, note, previous_next_review_at, new_next_review_at, occurred_at)
     VALUES ($1::uuid, $2, $3::uuid, $4, $5::timestamptz, $6::timestamptz, COALESCE($7::timestamptz, now()))
     RETURNING ${ACTION_COLUMNS}`,
    [
      params.holdId, params.actionType, params.actorUserId, params.note,
      params.previousNextReviewAt, params.newNextReviewAt, params.occurredAt ?? null,
    ],
  );
  if (!row) throw new Error('Retention hold action insert returned no row');
  return mapAction(row);
}

export interface DueRetentionHold {
  holdId: string;
  incidentId: string;
  incidentReference: string;
  projectId: string | null;
  category: RetentionHoldCategory;
  ownerUserId: string;
  nextReviewAt: string;
  /** True when the review date has already passed. A missed review alerts; it never auto-releases. */
  overdue: boolean;
}

interface DueRow extends Record<string, unknown> {
  hold_id: string; incident_id: string; incident_reference: string; project_id: string | null;
  category: RetentionHoldCategory; owner_user_id: string; next_review_at: string | Date; overdue: boolean;
}

/** Active holds whose review is overdue or falls within `leadDays` of `asOf`. */
export async function listHoldsDueForReview(params: { asOf: string; leadDays: number }): Promise<DueRetentionHold[]> {
  const rows = await query<DueRow>(
    `/* fleet-retention-holds:due */
     SELECT h.id AS hold_id, h.incident_id, i.incident_reference, i.project_id, h.category,
            h.owner_user_id, h.next_review_at, (h.next_review_at <= $1::timestamptz) AS overdue
       FROM fleet_incident_retention_holds h
       JOIN fleet_operational_incidents i ON i.id = h.incident_id
      WHERE h.status = 'active'
        AND h.next_review_at <= $1::timestamptz + make_interval(days => $2::int)
      ORDER BY h.next_review_at ASC`,
    [params.asOf, params.leadDays],
  );
  return rows.map((row) => ({
    holdId: row.hold_id, incidentId: row.incident_id, incidentReference: row.incident_reference,
    projectId: row.project_id, category: row.category, ownerUserId: row.owner_user_id,
    nextReviewAt: iso(row.next_review_at), overdue: row.overdue,
  }));
}

interface CandidateRow extends Record<string, unknown> { id: string }

/**
 * Active users who could plausibly hold `fleet.retention-holds` authority:
 * their role has an entry for the key, they carry a per-user override, or they
 * are super_admin (who bypasses RBAC and may therefore have no row at all).
 *
 * This is deliberately a SUPERSET and not the answer. The decision — override
 * priority, expiry, and the ancestor cascade that makes a child grant inert
 * when the parent module is blocked — belongs to `userHasPermission`, and
 * re-implementing it here in SQL would drift. `holdAuthority.ts` narrows this
 * list through that function before anyone is notified.
 *
 * (It also cannot live here: `userHasPermission` runs on the Neon HTTP driver,
 * which the real-Postgres harness that executes this file's SQL cannot reach.)
 */
export async function listHoldAuthorityCandidates(): Promise<string[]> {
  const candidates = await query<CandidateRow>(
    `/* fleet-retention-holds:authority-candidates */
     SELECT DISTINCT u.id
       FROM users u
       LEFT JOIN role_permissions rp ON rp.role = u.role AND rp.permission_key = $1
       LEFT JOIN user_permission_overrides o ON o.user_id = u.id AND o.permission_key = $1
      WHERE u.is_active IS DISTINCT FROM false
        AND (rp.id IS NOT NULL OR o.id IS NOT NULL OR u.role = 'super_admin')`,
    [FLEET_RETENTION_HOLDS_PERMISSION],
  );
  return candidates.map((candidate) => candidate.id);
}

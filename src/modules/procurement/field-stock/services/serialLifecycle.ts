/**
 * serialLifecycle.ts — Sprint E Track 1
 *
 * The ONLY sanctioned write path for stock_serials.status (and holder_id).
 * All other status writes are gated by the ESLint rule `no-direct-serial-status-write`
 * and the Gate 5 grep check in scripts/ci-local.sh.
 *
 * Architecture:
 *   - `promoteSerial(poolOrClient, args)` accepts either a Pool (wraps its own
 *     transaction) or a PoolClient (caller owns the transaction; used when
 *     composing with other writes in the same atomic unit).
 *   - Sets per-txn GUCs via `withSerialEventContext` before the UPDATE so the
 *     mig 387 AFTER trigger can read them for event emission.
 *   - Translates Postgres custom SQLSTATE FF001 / FF002 into typed errors
 *     (`LifecycleViolationError` / `HolderMismatchError`) for caller-friendly
 *     error handling and Bugsink alert filtering.
 *
 * Spec: docs/superpowers/specs/2026-05-28-serial-lifecycle-state-machine-sprintE-design.md
 * Migration dependency: mig 387 (triggers + transition matrix). Gated behind
 * __sprint_e_cutover_gate__ — safe to import pre-cutover; Pool path silently
 * skips trigger enforcement until mig 387 is applied.
 */

import type { Pool, PoolClient } from 'pg';
import { withSerialEventContext, type SerialEventContext } from '@/lib/db/serialEventContext';
import { log } from '@/lib/logger';

// ============================================================================
// Public Types
// ============================================================================

/**
 * The 8-state lifecycle vocabulary (plus legacy `available` retained until
 * the Track 5 backfill renames all rows to `in_stock`).
 *
 * Source: mig 387 stock_serials_status_check + transition matrix.
 */
export type SerialStatus =
  | 'available'              // legacy until backfill rename
  | 'in_stock'
  | 'allocated_to_project'
  | 'issued'
  | 'installed'
  | 'activated'
  | 'faulty'
  | 'returned'
  | 'scrapped';

// ============================================================================
// Typed Error Classes
// ============================================================================

/**
 * Thrown when the mig 387 validate trigger raises SQLSTATE FF001.
 * Message format: "lifecycle_violation: <from> → <to> not allowed for serial <serial_number>"
 */
export class LifecycleViolationError extends Error {
  /** The serial UUID that triggered the violation. */
  public readonly serialId: string;
  /** The from-state at the time of the violation attempt (null if newly inserted). */
  public readonly fromStatus: SerialStatus | null;
  /** The to-state that was rejected. */
  public readonly toStatus: SerialStatus;

  constructor(
    message: string,
    serialId: string,
    fromStatus: SerialStatus | null,
    toStatus: SerialStatus,
  ) {
    super(message);
    this.name = 'LifecycleViolationError';
    this.serialId   = serialId;
    this.fromStatus = fromStatus;
    this.toStatus   = toStatus;
  }
}

/**
 * Thrown when the mig 387 holder-validate trigger raises SQLSTATE FF002.
 * Message format: "holder_mismatch: status=<status> with holder_type=<type> not allowed for serial <serial_number>"
 */
export class HolderMismatchError extends Error {
  /** The serial UUID that triggered the mismatch. */
  public readonly serialId: string;
  /** The status being written when the mismatch was detected. */
  public readonly status: SerialStatus;
  /** The holder_id that was rejected (null means NULL holder was rejected). */
  public readonly holderId: string | null;

  constructor(
    message: string,
    serialId: string,
    status: SerialStatus,
    holderId: string | null,
  ) {
    super(message);
    this.name = 'HolderMismatchError';
    this.serialId = serialId;
    this.status   = status;
    this.holderId = holderId;
  }
}

// ============================================================================
// promoteSerial Interface
// ============================================================================

/**
 * Arguments for a single lifecycle promotion.
 * Extends SerialEventContext so every status write carries an audit trail.
 */
export interface PromoteSerialArgs extends SerialEventContext {
  /** UUID of the stock_serials row to update. */
  serialId:    string;
  /** Target lifecycle status. */
  toStatus:    SerialStatus;
  /**
   * New holder_id to set. When undefined the column is left unchanged.
   * Pass `null` explicitly to clear the holder (e.g. installed → holder = NULL).
   */
  toHolderId?: string | null;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Execute the status (and optional holder_id) UPDATE on a PoolClient that
 * already has GUCs set by withSerialEventContext. Translates PG custom
 * SQLSTATE errors into typed error classes.
 */
async function executeUpdate(client: PoolClient, args: PromoteSerialArgs): Promise<void> {
  try {
    if (args.toHolderId !== undefined) {
      await client.query(
        `UPDATE stock_serials
            SET status     = $1,
                holder_id  = $2,
                updated_at = NOW()
          WHERE id = $3`,
        [args.toStatus, args.toHolderId, args.serialId],
      );
    } else {
      await client.query(
        `UPDATE stock_serials
            SET status     = $1,
                updated_at = NOW()
          WHERE id = $2`,
        [args.toStatus, args.serialId],
      );
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('lifecycle_violation')) {
      throw new LifecycleViolationError(msg, args.serialId, null, args.toStatus);
    }
    if (msg.includes('holder_mismatch')) {
      throw new HolderMismatchError(msg, args.serialId, args.toStatus, args.toHolderId ?? null);
    }
    throw e;
  }
}

/**
 * The single sanctioned write path for `stock_serials.status` (and optionally
 * `holder_id`). Callers MUST provide `sourceTable` and `sourceId` so the mig
 * 387 emit trigger can record a non-anonymous event.
 *
 * @param poolOrClient
 *   - `Pool` → promoteSerial opens its own connection + transaction (COMMIT or
 *     ROLLBACK on success / error).
 *   - `PoolClient` → uses the caller's open connection directly; the caller
 *     owns BEGIN/COMMIT/ROLLBACK. Use this form when composing with other
 *     writes inside the same atomic unit (e.g. inside custody postings).
 *
 * @throws LifecycleViolationError — mig 387 validate trigger rejected the
 *   transition (SQLSTATE FF001). The shared DB still uses the legacy schema
 *   (pre-cutover) — this error only fires after mig 387 is applied.
 * @throws HolderMismatchError — mig 387 holder-validate trigger rejected the
 *   (status, holder_type) pair (SQLSTATE FF002).
 */
export async function promoteSerial(
  poolOrClient: Pool | PoolClient,
  args: PromoteSerialArgs,
): Promise<void> {
  // Distinguish Pool from PoolClient: Pool exposes a `connect()` method;
  // PoolClient (already-checked-out client) does not.
  if ('connect' in poolOrClient) {
    // Pool path — manage the connection + transaction here.
    const pool = poolOrClient as Pool;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withSerialEventContext(client, args, () => executeUpdate(client, args));
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      log.error('promoteSerial: transaction rolled back', {
        serialId: args.serialId,
        toStatus: args.toStatus,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      client.release();
    }
  } else {
    // PoolClient path — caller owns BEGIN/COMMIT/ROLLBACK.
    const client = poolOrClient as PoolClient;
    await withSerialEventContext(client, args, () => executeUpdate(client, args));
  }
}

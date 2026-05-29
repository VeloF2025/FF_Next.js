/**
 * Sprint E Track 4.1 (SOP-4.4): issue-time block enforcement.
 *
 * Refuses to issue stock to a blocked holder. `is_blocked` is read from
 * `v_holder_accountability` (sourced from `stock_accountability.is_blocked`,
 * mig 384). The picking-process handler calls this after resolving the recipient
 * holder and BEFORE any custody/serial write, then maps `HolderBlockedError` to
 * an HTTP 409 so the PWA can surface the reason to the user.
 *
 * Kept as a standalone helper (rather than inline in the handler) so the guard is
 * unit-testable in isolation — mirroring how `promoteSerial` is exercised directly
 * in the Sprint E DB tests.
 */
import type { TxnClient } from '@/lib/db-pool';

/** Thrown when an issue picking targets a holder flagged `is_blocked` in accountability. */
export class HolderBlockedError extends Error {
  readonly holderId: string;
  readonly blockedReason: string | null;

  constructor(holderId: string, blockedReason: string | null) {
    super(`holder_blocked: ${holderId}`);
    this.name = 'HolderBlockedError';
    this.holderId = holderId;
    this.blockedReason = blockedReason;
  }
}

interface BlockRow extends Record<string, unknown> {
  is_blocked: boolean;
  blocked_reason: string | null;
}

/**
 * Throw `HolderBlockedError` if the holder is currently blocked; no-op otherwise.
 *
 * A holder with no `stock_accountability` row is NOT blocked — the view COALESCEs
 * `is_blocked` to false, and a missing view row (`rows[0]` undefined) is treated as
 * not-blocked. Runs inside the caller's transaction so a throw rolls back any work
 * the handler did before the guard.
 */
export async function assertHolderNotBlocked(
  txn: TxnClient,
  holderId: string,
): Promise<void> {
  const rows = await txn.query<BlockRow>(
    `SELECT is_blocked, blocked_reason
       FROM v_holder_accountability
      WHERE holder_id = $1`,
    [holderId],
  );
  const row = rows[0];
  if (row?.is_blocked) {
    throw new HolderBlockedError(holderId, row.blocked_reason);
  }
}

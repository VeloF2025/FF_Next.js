/**
 * pickingSerialPromotion.ts — Track 2.2 helper
 *
 * Per-serial promoteSerial loop for the picking process handler. Extracted to
 * keep the route file under the 300-line ceiling (CLAUDE.md #11).
 *
 * Why a helper instead of inlining: both branches of process.ts (issue/done
 * path and non-issue destination path) need the same shape — loop serial IDs,
 * call promoteSerial with sourceTable='stock_pickings'. Centralising avoids
 * drift in the txn.client unwrap pattern that bit Track 2.1.
 */

import type { TxnClient } from '@/lib/db-pool';
import { promoteSerial, type SerialStatus } from './serialLifecycle';

export interface PromotePickingSerialsArgs {
  toStatus:     SerialStatus;
  /** Omit to leave holder_id unchanged. Pass `null` to clear. Pass a UUID to set. */
  toHolderId?:  string | null;
  /** Picking UUID — recorded on each stock_serial_events row. */
  sourceId:     string;
  actorStaffId: string | null;
  payload:      Record<string, unknown>;
}

/**
 * Promote every serial in `serialIds` through mig 387 triggers under the
 * caller's transaction. Pass `txn.client` (the raw PoolClient) — the TxnClient
 * wrapper has no `release`, which would misroute promoteSerial through its
 * Pool branch and crash at runtime.
 */
export async function promotePickingSerials(
  txn: TxnClient,
  serialIds: string[],
  args: PromotePickingSerialsArgs,
): Promise<void> {
  for (const serialId of serialIds) {
    await promoteSerial(txn.client, {
      serialId,
      toStatus:     args.toStatus,
      ...(args.toHolderId !== undefined ? { toHolderId: args.toHolderId } : {}),
      sourceTable:  'stock_pickings',
      sourceId:     args.sourceId,
      actorStaffId: args.actorStaffId,
      payload:      args.payload,
    });
  }
}

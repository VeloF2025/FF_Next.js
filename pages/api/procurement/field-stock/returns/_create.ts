/**
 * Shared return-create core.
 *
 * Extracted from returns/index.ts so both auth tiers can reuse it:
 *   - the main withAuth route resolves the actor from req.user.id → staff JOIN users
 *   - the /my stores PWA route (withMySession) passes session.staffId directly
 *     via requireReturnCreator
 *
 * actor.staffId is the FK written to stock_returns.returned_by_id.
 * actor.returnedByName is "First Last" trimmed, written to returned_by_name.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db';
import { transaction } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  promoteSerial,
  LifecycleViolationError,
  HolderMismatchError,
} from '@/modules/procurement/field-stock/services/serialLifecycle';

// Valid CHECK constraint values — kept here so createReturn validates against them.
const VALID_RETURN_REASONS = ['unused', 'job_cancelled', 'wrong_item', 'excess', 'faulty', 'customer_refused'] as const;
const VALID_CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged', 'non_functional'] as const;

export interface ReturnActor {
  /** staff.id — FK for stock_returns.returned_by_id */
  staffId: string;
  /** "First Last" display name written to returned_by_name */
  returnedByName: string;
}

/**
 * Core return-create logic, shared by the withAuth procurement route and the
 * withMySession /my/stores/returns route.
 *
 * Pre-condition: the caller has already verified role authorisation; this
 * function accepts the resolved actor directly and proceeds to validation +
 * transaction.
 */
export async function createReturn(
  req: NextApiRequest,
  res: NextApiResponse,
  actor: ReturnActor,
): Promise<void> {
  try {
    const {
      originalPickingId,
      returnToLocationId,
      lines,
      notes,
      idempotencyKey,
    } = req.body;

    // ── Idempotency check ──────────────────────────────────────────────────────
    if (idempotencyKey && typeof idempotencyKey === 'string' && idempotencyKey.trim() !== '') {
      const existing = await sql`
        SELECT id, return_number, status
        FROM stock_returns
        WHERE idempotency_key = ${idempotencyKey}
        LIMIT 1
      `;
      if (existing[0]) {
        log.warn('returns.create.idempotent_replay', { idempotencyKey, returnId: existing[0].id });
        return void apiResponse.success(res, existing[0]);
      }
    }

    // ── Input validation ───────────────────────────────────────────────────────
    if (!returnToLocationId) {
      return void apiResponse.validationError(res, { returnToLocationId: 'Return location is required' });
    }

    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      return void apiResponse.validationError(res, { lines: 'At least one return line is required' });
    }

    // Validate per-line fields against CHECK constraints
    for (const line of lines) {
      if (!line.stockItemId || typeof line.stockItemId !== 'string' || line.stockItemId.trim() === '') {
        return void apiResponse.validationError(res, { stockItemId: 'stockItemId is required on each line' });
      }
      if (line.returnReason !== undefined && line.returnReason !== null) {
        if (!(VALID_RETURN_REASONS as ReadonlyArray<string>).includes(line.returnReason)) {
          return void apiResponse.validationError(res, {
            returnReason: `Invalid returnReason "${line.returnReason}". Must be one of: ${VALID_RETURN_REASONS.join(', ')}`
          });
        }
      }
      if (line.condition !== undefined && line.condition !== null) {
        if (!(VALID_CONDITIONS as ReadonlyArray<string>).includes(line.condition)) {
          return void apiResponse.validationError(res, {
            condition: `Invalid condition "${line.condition}". Must be one of: ${VALID_CONDITIONS.join(', ')}`
          });
        }
      }
    }

    // ── Generate return number via SQL function (race-safe) ────────────────────
    const numResult = await sql`SELECT generate_return_number() AS num`;
    const returnNumber = numResult[0]?.num as string;

    // ── Create header + lines + flip serials to 'returned' (atomic) ────────────
    // Track 7: each serialized line routes through promoteSerial('returned',
    // holder cleared) so the mig 387 emit trigger records exactly one event. The
    // legacy emit_serial_event_on_return{,_line_insert} triggers — which did a
    // guarded `UPDATE … SET status='returned'` and would silently swallow an
    // FF001 (e.g. issued→returned has no pre-387 matrix row) — are dropped by
    // mig 387. This is now the only creation-time 'returned' write path.
    const idempotencyValue =
      (idempotencyKey && typeof idempotencyKey === 'string' && idempotencyKey.trim() !== '')
        ? idempotencyKey
        : null;

    let returnId: string;
    try {
      returnId = await transaction(async (txn) => {
        const headerRow = await txn.queryOne<{ id: string }>(
          `INSERT INTO stock_returns (
             return_number, original_picking_id, returned_by_id, returned_by_name,
             return_to_location_id, status, notes, return_date, idempotency_key
           ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW(), $7)
           RETURNING id`,
          [
            returnNumber,
            originalPickingId || null,
            actor.staffId,
            actor.returnedByName || null,
            returnToLocationId,
            notes || null,
            idempotencyValue,
          ],
        );
        const newReturnId = headerRow?.id;
        if (!newReturnId) {
          throw new Error('Failed to create return header');
        }

        for (const line of lines) {
          await txn.query(
            `INSERT INTO stock_return_lines (
               return_id, stock_item_id, serial_id, serial_number,
               quantity, condition, return_reason, notes
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              newReturnId,
              line.stockItemId,
              line.serialId || null,
              line.serialNumber || null,
              line.quantity || 1,
              line.condition || 'good',
              line.returnReason || 'unused',
              line.notes || null,
            ],
          );

          // Flip the serial to 'returned' with holder cleared (back at warehouse).
          if (line.serialId) {
            await promoteSerial(txn.client, {
              serialId:     line.serialId,
              toStatus:     'returned',
              toHolderId:   null,
              sourceTable:  'stock_returns',
              sourceId:     newReturnId,
              actorStaffId: actor.staffId,
              payload: {
                return_number: returnNumber,
                line_reason: line.returnReason ?? 'unused',
              },
            });
          }
        }

        return newReturnId;
      });
    } catch (err: unknown) {
      if (err instanceof LifecycleViolationError || err instanceof HolderMismatchError) {
        log.warn('returns.create.lifecycle_rejected', { error: (err as Error).message }, 'field-stock');
        return void apiResponse.validationError(res, { serial: (err as Error).message });
      }
      throw err;
    }

    // ── Fetch complete return with lines ───────────────────────────────────────
    const result = await sql`
      SELECT
        r.*,
        (
          SELECT json_agg(
            json_build_object(
              'id', rl.id,
              'stock_item_id', rl.stock_item_id,
              'serial_id', rl.serial_id,
              'serial_number', rl.serial_number,
              'quantity', rl.quantity,
              'condition', rl.condition,
              'return_reason', rl.return_reason,
              'notes', rl.notes
            )
          )
          FROM stock_return_lines rl
          WHERE rl.return_id = r.id
        ) as lines
      FROM stock_returns r
      WHERE r.id = ${returnId}
    `;

    log.info('returns.create', { staffId: actor.staffId, returnNumber, lineCount: lines.length, idempotencyKey: idempotencyKey ?? null });
    return void apiResponse.created(res, result[0]);
  } catch (error: unknown) {
    log.error('Error creating return', { error }, 'field-stock');
    return void apiResponse.internalError(res, error);
  }
}

/**
 * Movement Reversal Service
 * Reverses a stock movement: creates inverse movement, marks original as reversed,
 * reverts stock_quant changes, and if serial was involved reverts to previous_status.
 */

import { transaction } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { createAuditLog } from '@/services/procurement/auditService';
import { promoteSerial, type SerialStatus } from '@/modules/procurement/field-stock/services/serialLifecycle';

interface ReverseMovementParams {
  movementId: string;
  reason: string;
  performedBy: string;
  performedByName: string;
}

interface ReverseMovementResult {
  success: boolean;
  error?: string;
  reversalMovementId?: string;
}

/**
 * Reverse a stock movement.
 * 1. Validate movement exists and is not already reversed
 * 2. Create reversal movement (swap from/to, negate qty)
 * 3. Mark original as reversed
 * 4. Reverse stock quantity changes
 * 5. If serial involved, revert to previous_status
 * 6. Audit log with action='reverse' + mandatory reason
 */
export async function reverseMovement(
  params: ReverseMovementParams,
): Promise<ReverseMovementResult> {
  const { movementId, reason, performedBy, performedByName } = params;

  try {
    // Guard errors (movement missing / already reversed / not completed) are
    // signalled by throwing a ReversalGuardError inside the txn so the whole
    // transaction rolls back; they're translated back to {success:false} below.
    const { reversalId, guardError, original } = await transaction(async (txn) => {
      // 1. Fetch + LOCK the original movement. FOR UPDATE serializes concurrent
      //    reversals of the same movement — the second sees is_reversed=true.
      const movements = await txn.query<{
        id: string; movement_type: string; from_location: string | null;
        to_location: string | null; status: string; is_reversed: boolean;
        reference_number: string | null; reference_type: string | null;
        reference_id: string | null; project_id: string | null;
        notes: string | null; source_type: string | null;
      }>(
        `SELECT id, movement_type, from_location, to_location, status,
                is_reversed, reference_number, reference_type, reference_id,
                project_id, notes, source_type
           FROM stock_movements WHERE id = $1 FOR UPDATE`,
        [movementId],
      );

      const guard = (error: string) => ({ reversalId: null, guardError: error, original: null });
      if (movements.length === 0) return guard('Movement not found');
      const original = movements[0]!;
      if (original.is_reversed) return guard('Movement has already been reversed');
      if (original.status !== 'completed') return guard('Only completed movements can be reversed');

      // 2. Create reversal movement (swap from/to).
      const reversalRows = await txn.query<{ id: string }>(
        `INSERT INTO stock_movements (
           id, project_id, movement_type, reference_number, reference_type, reference_id,
           from_location, to_location, status, movement_date, confirmed_at,
           requested_by, processed_by, notes, source_type, original_movement_id
         ) VALUES (
           gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'completed', NOW(), NOW(),
           $8, $8, $9, 'fibreflow', $10
         ) RETURNING id`,
        [
          original.project_id, `REVERSAL:${original.movement_type}`, `REV-${original.reference_number}`,
          original.reference_type, original.reference_id, original.to_location, original.from_location,
          performedBy, `Reversal of ${original.reference_number}: ${reason}`, movementId,
        ],
      );
      const reversal = reversalRows[0]!;

      // 3. Mark original as reversed.
      await txn.query(
        `UPDATE stock_movements
            SET is_reversed = true, reversed_by = $2, reversed_at = NOW(), reversal_reason = $3
          WHERE id = $1`,
        [movementId, performedByName, reason],
      );

      // 4. Reverse stock quantity changes for each movement item.
      const movementItems = await txn.query<{
        stock_movement_id: string; item_code: string | null;
        actual_quantity: number | string | null; serial_numbers: unknown;
      }>(
        `SELECT stock_movement_id, item_code, actual_quantity, serial_numbers
           FROM stock_movement_items WHERE stock_movement_id = $1`,
        [movementId],
      );

      for (const item of movementItems) {
        const qty = Number(item.actual_quantity || 0);
        if (qty <= 0) continue;

        if (item.item_code) {
          await txn.query(
            `UPDATE stock_items
                SET qty_available = COALESCE(qty_available, 0) - $2, updated_at = NOW()
              WHERE item_code = $1`,
            [item.item_code, qty],
          );
        }

        await txn.query(
          `INSERT INTO stock_movement_items (
             id, stock_movement_id, project_id, item_code, description,
             planned_quantity, actual_quantity, uom, item_status
           ) VALUES (gen_random_uuid(), $1, $2, $3, 'Reversal', $4, $4, 'EA', 'reversed')`,
          [reversal.id, original.project_id, item.item_code, qty],
        );
      }

      // 5. If serial was involved, revert it to its previous status. This is a
      //    deliberate backwards/off-matrix correction, so it routes through
      //    promoteSerial with bypass=true — the mig 387 validate trigger logs it to
      //    the violations side-table and the emit trigger records a force_corrected
      //    event. Legacy 'available' normalises to 'in_stock' (post-cutover vocab).
      //    Uses txn.client so serial writes commit/roll back with this transaction.
      for (const item of movementItems) {
        if (!item.serial_numbers) continue;
        const serials: string[] = typeof item.serial_numbers === 'string'
          ? JSON.parse(item.serial_numbers)
          : (item.serial_numbers as string[]);

        for (const serialNum of serials) {
          const serialRows = await txn.query<{ id: string; previous_status: string | null }>(
            `SELECT id, previous_status FROM stock_serials WHERE serial_number = $1`,
            [serialNum],
          );
          const serialRow = serialRows[0];
          if (!serialRow) continue;

          const prev = serialRow.previous_status ?? null;
          const revertTo: SerialStatus = (!prev || prev === 'available') ? 'in_stock' : (prev as SerialStatus);

          await promoteSerial(txn.client, {
            serialId:    serialRow.id,
            toStatus:    revertTo,
            sourceTable: 'stock_movements',
            sourceId:    movementId,
            actorUserId: performedBy,
            payload:     { reversal: true, reason },
            bypass:      true,
          });
        }
      }

      return {
        reversalId: reversal.id,
        guardError: null as string | null,
        original: {
          status: original.status,
          fromLocation: original.from_location,
          toLocation: original.to_location,
        },
      };
    });

    if (guardError || !reversalId) return { success: false, error: guardError ?? 'Movement not found' };

    // 6. Audit log (fire-and-forget, outside the txn — matches other handlers).
    createAuditLog({
      entityType: 'stock_movement',
      entityId: movementId,
      action: 'reverse',
      performedBy,
      performedByName,
      oldValues: {
        status: original?.status,
        isReversed: false,
        fromLocation: original?.fromLocation,
        toLocation: original?.toLocation,
      },
      newValues: {
        isReversed: true,
        reversalMovementId: reversalId,
      },
      reason,
    });

    log.info('Movement reversed successfully', {
      data: { movementId, reversalId },
    }, 'movementReversalService');

    return { success: true, reversalMovementId: reversalId };
  } catch (error) {
    log.error('Failed to reverse movement', { data: error }, 'movementReversalService');
    return { success: false, error: 'Internal error during movement reversal' };
  }
}

/**
 * Movement Reversal Service
 * Reverses a stock movement: creates inverse movement, marks original as reversed,
 * reverts stock_quant changes, and if serial was involved reverts to previous_status.
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { createAuditLog } from '@/services/procurement/auditService';

const sql = neon(process.env.DATABASE_URL!);

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
    // 1. Fetch original movement
    const movements = await sql`
      SELECT id, movement_type, from_location, to_location, status,
             is_reversed, reference_number, reference_type, reference_id,
             project_id, notes, source_type
      FROM stock_movements
      WHERE id = ${movementId}
    `;

    if (movements.length === 0) {
      return { success: false, error: 'Movement not found' };
    }

    const original = movements[0]!;

    if (original.is_reversed) {
      return { success: false, error: 'Movement has already been reversed' };
    }

    if (original.status !== 'completed') {
      return { success: false, error: 'Only completed movements can be reversed' };
    }

    // 2. Create reversal movement (swap from/to)
    const [reversal] = await sql`
      INSERT INTO stock_movements (
        id,
        project_id,
        movement_type,
        reference_number,
        reference_type,
        reference_id,
        from_location,
        to_location,
        status,
        movement_date,
        confirmed_at,
        requested_by,
        processed_by,
        notes,
        source_type,
        original_movement_id
      ) VALUES (
        gen_random_uuid(),
        ${original.project_id},
        ${`REVERSAL:${original.movement_type}`},
        ${`REV-${original.reference_number}`},
        ${original.reference_type},
        ${original.reference_id},
        ${original.to_location},
        ${original.from_location},
        'completed',
        NOW(),
        NOW(),
        ${performedBy},
        ${performedBy},
        ${`Reversal of ${original.reference_number}: ${reason}`},
        'fibreflow',
        ${movementId}
      )
      RETURNING id
    `;

    // 3. Mark original as reversed
    await sql`
      UPDATE stock_movements
      SET is_reversed = true,
          reversed_by = ${performedByName},
          reversed_at = NOW(),
          reversal_reason = ${reason}
      WHERE id = ${movementId}
    `;

    // 4. Reverse stock quantity changes for each movement item
    const movementItems = await sql`
      SELECT stock_movement_id, item_code, actual_quantity, serial_numbers
      FROM stock_movement_items
      WHERE stock_movement_id = ${movementId}
    `;

    for (const item of movementItems) {
      const qty = Number(item.actual_quantity || 0);
      if (qty <= 0) continue;

      // Negate quantity: remove from to_location, add back to from_location
      if (item.item_code) {
        await sql`
          UPDATE stock_items
          SET qty_available = COALESCE(qty_available, 0) - ${qty},
              updated_at = NOW()
          WHERE item_code = ${item.item_code}
        `;
      }

      // Insert reversal movement item
      await sql`
        INSERT INTO stock_movement_items (
          id, stock_movement_id, project_id,
          item_code, description, planned_quantity, actual_quantity,
          uom, item_status
        ) VALUES (
          gen_random_uuid(),
          ${reversal!.id},
          ${original.project_id},
          ${item.item_code},
          ${'Reversal'},
          ${qty},
          ${qty},
          'EA',
          'reversed'
        )
      `;
    }

    // 5. If serial was involved, revert to previous_status
    for (const item of movementItems) {
      if (item.serial_numbers) {
        const serials: string[] = typeof item.serial_numbers === 'string'
          ? JSON.parse(item.serial_numbers)
          : item.serial_numbers;

        for (const serialNum of serials) {
          await sql`
            UPDATE stock_serials
            SET status = COALESCE(previous_status, 'available'),
                previous_status = status,
                status_changed_at = NOW(),
                status_changed_by = ${performedByName},
                updated_at = NOW()
            WHERE serial_number = ${serialNum}
          `;
        }
      }
    }

    // 6. Audit log
    createAuditLog({
      entityType: 'stock_movement',
      entityId: movementId,
      action: 'reverse',
      performedBy,
      performedByName,
      oldValues: {
        status: original.status,
        isReversed: false,
        fromLocation: original.from_location,
        toLocation: original.to_location,
      },
      newValues: {
        isReversed: true,
        reversalMovementId: reversal!.id,
      },
      reason,
    });

    log.info('Movement reversed successfully', {
      data: { movementId, reversalId: reversal!.id },
    }, 'movementReversalService');

    return { success: true, reversalMovementId: reversal!.id as string };
  } catch (error) {
    log.error('Failed to reverse movement', { data: error }, 'movementReversalService');
    return { success: false, error: 'Internal error during movement reversal' };
  }
}

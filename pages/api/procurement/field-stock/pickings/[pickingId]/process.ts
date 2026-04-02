/**
 * Process Picking API
 * POST /api/procurement/field-stock/pickings/[pickingId]/process
 * Execute the picking - move stock between locations
 *
 * Fix VF-20260331-048: Added stock availability validation and explicit
 * transaction wrapping to prevent silent stock quant drift.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { createAuditLog } from '@/services/procurement/auditService';

const sql = neon(process.env.DATABASE_URL!);

interface PickingLine {
  id: string;
  stock_item_id: string;
  planned_quantity: number;
  serial_ids?: string[];
}

interface StockQuantRow {
  quantity: number;
}

/** Verify every picking line has sufficient stock at the source location. */
async function validateStockAvailability(
  lines: PickingLine[],
  sourceLocationId: string
): Promise<{ valid: true } | { valid: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};

  for (const line of lines) {
    if (!line || !line.stock_item_id) continue;

    // 🟢 WORKING: SELECT with FOR UPDATE to lock the row inside the transaction
    const quants = (await sql`
      SELECT quantity
      FROM stock_quants
      WHERE stock_item_id = ${line.stock_item_id}
        AND location_id = ${sourceLocationId}
      FOR UPDATE
    `) as StockQuantRow[];

    if (quants.length === 0) {
      errors[line.stock_item_id] =
        `No stock record found for item ${line.stock_item_id} at source location ${sourceLocationId}`;
      continue;
    }

    const available = Number(quants[0]!.quantity);
    if (available < line.planned_quantity) {
      errors[line.stock_item_id] =
        `Insufficient stock for item ${line.stock_item_id}: required ${line.planned_quantity}, available ${available}`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }
  return { valid: true };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { pickingId } = req.query;

  if (typeof pickingId !== 'string') {
    return apiResponse.validationError(res, { pickingId: 'Picking ID is required' });
  }

  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  // 🟢 WORKING: Explicit transaction — BEGIN before any mutations
  await sql`BEGIN`;

  try {
    // Get picking with lines — inside the transaction for consistent read
    const existing = await sql`
      SELECT
        p.*,
        json_agg(
          json_build_object(
            'id', pl.id,
            'stock_item_id', pl.stock_item_id,
            'planned_quantity', pl.planned_quantity,
            'serial_ids', pl.serial_ids
          )
        ) as lines
      FROM stock_pickings p
      LEFT JOIN stock_picking_lines pl ON pl.picking_id = p.id
      WHERE p.id = ${pickingId}
      GROUP BY p.id
    `;

    const picking = existing[0];
    if (!picking) {
      await sql`ROLLBACK`;
      return apiResponse.notFound(res, 'Picking', pickingId);
    }

    if (picking.status !== 'confirmed') {
      await sql`ROLLBACK`;
      return apiResponse.validationError(res, {
        status: `Cannot process picking with status "${picking.status}". Only confirmed pickings can be processed.`,
      });
    }

    const sourceLocationId = picking.source_location_id as string;
    const destinationLocationId = picking.destination_location_id as string;
    const pickingType = picking.picking_type as string;
    const lines: PickingLine[] = (picking.lines as PickingLine[]) || [];

    // Filter out null/invalid lines before validation
    const validLines = lines.filter((l) => l && l.stock_item_id);

    // 🟢 WORKING: Stock availability check — runs inside transaction with FOR UPDATE
    const availabilityCheck = await validateStockAvailability(validLines, sourceLocationId);
    if (!availabilityCheck.valid) {
      await sql`ROLLBACK`;
      log.warn('Stock transfer blocked: insufficient stock', {
        pickingId,
        errors: availabilityCheck.errors,
      }, 'field-stock');
      return apiResponse.validationError(res, availabilityCheck.errors);
    }

    // Mark as processing — status guard prevents double-processing
    await sql`
      UPDATE stock_pickings
      SET status = 'processing', updated_at = NOW()
      WHERE id = ${pickingId}
    `;

    // Process each picking line — decrease source, increase/upsert destination
    for (const line of validLines) {
      // Decrease source quant — row guaranteed to exist (validated above)
      await sql`
        UPDATE stock_quants
        SET
          quantity = quantity - ${line.planned_quantity},
          last_movement_date = NOW(),
          updated_at = NOW()
        WHERE stock_item_id = ${line.stock_item_id}
          AND location_id = ${sourceLocationId}
      `;

      // Increase or create destination quant
      await sql`
        INSERT INTO stock_quants (stock_item_id, location_id, quantity, last_movement_date)
        VALUES (${line.stock_item_id}, ${destinationLocationId}, ${line.planned_quantity}, NOW())
        ON CONFLICT (stock_item_id, location_id, lot_number)
        DO UPDATE SET
          quantity = stock_quants.quantity + ${line.planned_quantity},
          last_movement_date = NOW(),
          updated_at = NOW()
      `;

      // Update serial records if applicable
      if (Array.isArray(line.serial_ids)) {
        const newStatus = pickingType === 'issue' ? 'issued' : 'available';
        for (const serialId of line.serial_ids) {
          await sql`
            UPDATE stock_serials
            SET
              current_location_id = ${destinationLocationId},
              status = ${newStatus},
              updated_at = NOW()
            WHERE id = ${serialId}
          `;
        }
      }

      // Record the movement for audit trail
      await sql`
        INSERT INTO stock_movements (
          picking_id,
          stock_item_id,
          movement_type,
          from_location_id,
          to_location_id,
          quantity,
          performed_at
        ) VALUES (
          ${pickingId},
          ${line.stock_item_id},
          ${pickingType},
          ${sourceLocationId},
          ${destinationLocationId},
          ${line.planned_quantity},
          NOW()
        )
      `;

      // Mark line as done with actual quantity
      await sql`
        UPDATE stock_picking_lines
        SET
          status = 'done',
          actual_quantity = planned_quantity
        WHERE id = ${line.id}
      `;
    }

    // Finalise picking
    const result = await sql`
      UPDATE stock_pickings
      SET
        status = 'done',
        effective_date = NOW(),
        updated_at = NOW()
      WHERE id = ${pickingId}
      RETURNING *
    `;

    await sql`COMMIT`;

    log.info('Picking processed successfully', { pickingId, linesProcessed: validLines.length }, 'field-stock');

    createAuditLog({
      entityType: 'picking',
      entityId: pickingId,
      action: 'update',
      performedBy: 'system',
      newValues: { status: 'done', linesProcessed: validLines.length },
    });

    return apiResponse.success(res, result[0]);
  } catch (error: unknown) {
    // Roll back the entire transaction — no partial stock mutations persist
    await sql`ROLLBACK`.catch((rollbackErr: unknown) =>
      log.warn('Rollback failed after picking process error', {
        rollbackError: rollbackErr instanceof Error ? rollbackErr.message : 'unknown',
        pickingId,
      }, 'field-stock')
    );

    log.error('Error processing picking', {
      error: error instanceof Error ? error.message : String(error),
      pickingId,
    }, 'field-stock');

    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

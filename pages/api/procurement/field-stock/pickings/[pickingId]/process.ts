/**
 * Process Picking API
 * POST /api/procurement/field-stock/pickings/[pickingId]/process
 * Execute the picking - move stock between locations
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

interface PickingLine {
  id: string;
  stock_item_id: string;
  planned_quantity: number;
  serial_ids?: string[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { pickingId } = req.query;

  if (typeof pickingId !== 'string') {
    return apiResponse.validationError(res, { pickingId: 'Picking ID is required' });
  }

  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    // Get picking with lines
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
      return apiResponse.notFound(res, 'Picking', pickingId);
    }

    if (picking.status !== 'confirmed') {
      return apiResponse.validationError(res, {
        status: `Cannot process picking with status "${picking.status}". Only confirmed pickings can be processed.`
      });
    }

    const sourceLocationId = picking.source_location_id as string;
    const destinationLocationId = picking.destination_location_id as string;
    const pickingType = picking.picking_type as string;

    // Update status to processing first
    await sql`
      UPDATE stock_pickings
      SET status = 'processing', updated_at = NOW()
      WHERE id = ${pickingId}
    `;

    // Process each line - update stock quants and serials
    const lines: PickingLine[] = (picking.lines as PickingLine[]) || [];
    for (const line of lines) {
      if (!line || !line.stock_item_id) continue;

      // Decrease source quant
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

      // Update serials if applicable
      if (line.serial_ids && Array.isArray(line.serial_ids)) {
        for (const serialId of line.serial_ids) {
          const newStatus = pickingType === 'issue' ? 'issued' : 'available';
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

      // Record movement
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

      // Update line status
      await sql`
        UPDATE stock_picking_lines
        SET
          status = 'done',
          actual_quantity = planned_quantity
        WHERE id = ${line.id}
      `;
    }

    // Update picking to done
    const result = await sql`
      UPDATE stock_pickings
      SET
        status = 'done',
        effective_date = NOW(),
        updated_at = NOW()
      WHERE id = ${pickingId}
      RETURNING *
    `;

    log.info('Picking processed', { pickingId, linesProcessed: lines.length }, 'field-stock');
    return apiResponse.success(res, result[0]);
  } catch (error: unknown) {
    // Rollback status on error
    await sql`
      UPDATE stock_pickings
      SET status = 'confirmed', updated_at = NOW()
      WHERE id = ${pickingId}
    `.catch(() => {});

    log.error('Error processing picking', { error, pickingId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

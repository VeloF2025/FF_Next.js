/**
 * Accept Return API
 * POST /api/procurement/field-stock/returns/[returnId]/accept
 * Accept inspected return and restock items
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

interface ReturnLine {
  id: string;
  stock_item_id: string;
  serial_id?: string;
  quantity: number;
  disposition?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { returnId } = req.query;

  if (typeof returnId !== 'string') {
    return apiResponse.validationError(res, { returnId: 'Return ID is required' });
  }

  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    // Get return with lines
    const existing = await sql`
      SELECT
        r.*,
        json_agg(
          json_build_object(
            'id', rl.id,
            'stock_item_id', rl.stock_item_id,
            'serial_id', rl.serial_id,
            'quantity', rl.quantity,
            'disposition', rl.disposition
          )
        ) as lines
      FROM stock_returns r
      LEFT JOIN stock_return_lines rl ON rl.return_id = r.id
      WHERE r.id = ${returnId}
      GROUP BY r.id
    `;

    const returnRecord = existing[0];
    if (!returnRecord) {
      return apiResponse.notFound(res, 'Return', returnId);
    }

    if (returnRecord.status !== 'inspected') {
      return apiResponse.validationError(res, {
        status: `Cannot accept return with status "${returnRecord.status}". Only inspected returns can be accepted.`
      });
    }

    const returnToLocationId = returnRecord.return_to_location_id as string;

    // Process each line based on disposition
    const lines: ReturnLine[] = (returnRecord.lines as ReturnLine[]) || [];
    for (const line of lines) {
      if (!line || !line.stock_item_id) continue;

      const disposition = line.disposition || 'restock';

      if (disposition === 'restock') {
        // Add back to destination quant
        await sql`
          INSERT INTO stock_quants (stock_item_id, location_id, quantity, last_movement_date)
          VALUES (${line.stock_item_id}, ${returnToLocationId}, ${line.quantity}, NOW())
          ON CONFLICT (stock_item_id, location_id, lot_number)
          DO UPDATE SET
            quantity = stock_quants.quantity + ${line.quantity},
            last_movement_date = NOW(),
            updated_at = NOW()
        `;

        // Update serial if applicable
        if (line.serial_id) {
          await sql`
            UPDATE stock_serials
            SET
              current_location_id = ${returnToLocationId},
              status = 'available',
              updated_at = NOW()
            WHERE id = ${line.serial_id}
          `;
        }
      } else if (disposition === 'scrap') {
        // Mark serial as scrapped
        if (line.serial_id) {
          await sql`
            UPDATE stock_serials
            SET
              status = 'scrapped',
              updated_at = NOW()
            WHERE id = ${line.serial_id}
          `;
        }
      } else if (disposition === 'repair') {
        // Mark serial as faulty (awaiting repair)
        if (line.serial_id) {
          await sql`
            UPDATE stock_serials
            SET
              status = 'faulty',
              updated_at = NOW()
            WHERE id = ${line.serial_id}
          `;
        }
      }

      // Record movement
      await sql`
        INSERT INTO stock_movements (
          stock_item_id,
          movement_type,
          to_location_id,
          quantity,
          notes,
          performed_at
        ) VALUES (
          ${line.stock_item_id},
          'return',
          ${returnToLocationId},
          ${line.quantity},
          ${`Return accepted - disposition: ${disposition}`},
          NOW()
        )
      `;
    }

    // Update return status
    const result = await sql`
      UPDATE stock_returns
      SET
        status = 'restocked',
        updated_at = NOW()
      WHERE id = ${returnId}
      RETURNING *
    `;

    log.info('Return accepted and restocked', { returnId, linesProcessed: lines.length }, 'field-stock');
    return apiResponse.success(res, result[0]);
  } catch (error: unknown) {
    log.error('Error accepting return', { error, returnId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

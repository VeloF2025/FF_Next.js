/**
 * Stock Picking Detail API
 * GET /api/procurement/field-stock/pickings/[pickingId] - Get single picking
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { pickingId } = req.query;

  if (typeof pickingId !== 'string') {
    return apiResponse.validationError(res, { pickingId: 'Picking ID is required' });
  }

  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const result = await sql`
      SELECT
        p.*,
        sl_src.name as source_location_name,
        sl_src.code as source_location_code,
        sl_dest.name as destination_location_name,
        sl_dest.code as destination_location_code,
        (
          SELECT json_agg(
            json_build_object(
              'id', pl.id,
              'stock_item_id', pl.stock_item_id,
              'planned_quantity', pl.planned_quantity,
              'actual_quantity', pl.actual_quantity,
              'serial_ids', pl.serial_ids,
              'status', pl.status,
              'notes', pl.notes,
              'item_name', si.name,
              'item_code', si.item_code
            )
          )
          FROM stock_picking_lines pl
          LEFT JOIN stock_items si ON si.id = pl.stock_item_id
          WHERE pl.picking_id = p.id
        ) as lines
      FROM stock_pickings p
      LEFT JOIN stock_locations sl_src ON sl_src.id = p.source_location_id
      LEFT JOIN stock_locations sl_dest ON sl_dest.id = p.destination_location_id
      WHERE p.id = ${pickingId}
    `;

    const picking = result[0];
    if (!picking) {
      return apiResponse.notFound(res, 'Picking', pickingId);
    }

    return apiResponse.success(res, picking);
  } catch (error: unknown) {
    log.error('Error fetching picking', { error, pickingId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

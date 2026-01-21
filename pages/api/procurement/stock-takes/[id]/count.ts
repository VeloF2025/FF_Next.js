/**
 * Stock Take Count API
 * POST /api/procurement/stock-takes/[id]/count - Record count for a line
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { StockTakeLineCountData } from '@/types/procurement/stockTake.types';

const sql = neon(process.env.DATABASE_URL!);

interface CountRequest extends StockTakeLineCountData {
  line_id: string;
  is_recount?: boolean;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Stock take ID is required');
  }

  try {
    // Verify stock take exists and is in progress
    const stockTake = await sql`SELECT id, status FROM stock_takes WHERE id = ${id}`;
    if (stockTake.length === 0) {
      return apiResponse.notFound(res, 'Stock take', id);
    }

    if (stockTake[0]!.status !== 'in_progress') {
      return apiResponse.badRequest(res, 'Stock take must be in progress to record counts');
    }

    const data: CountRequest = req.body;

    if (!data.line_id) {
      return apiResponse.badRequest(res, 'Line ID is required');
    }

    if (data.counted_quantity === undefined || data.counted_quantity === null) {
      return apiResponse.badRequest(res, 'Counted quantity is required');
    }

    // Verify line belongs to this stock take
    const line = await sql`
      SELECT id, status FROM stock_take_lines
      WHERE id = ${data.line_id} AND stock_take_id = ${id}
    `;

    if (line.length === 0) {
      return apiResponse.badRequest(res, 'Line not found in this stock take');
    }

    // Determine if this is a recount
    const isRecount = data.is_recount || line[0]!.status === 'counted';

    let result;
    if (isRecount) {
      // Record recount
      result = await sql`
        UPDATE stock_take_lines
        SET
          recount_quantity = ${data.counted_quantity},
          recounted_at = NOW(),
          recounted_by_name = ${data.counted_by_name || null},
          status = 'recounted',
          updated_at = NOW()
        WHERE id = ${data.line_id}
        RETURNING *
      `;
    } else {
      // Record initial count
      result = await sql`
        UPDATE stock_take_lines
        SET
          counted_quantity = ${data.counted_quantity},
          counted_at = NOW(),
          counted_by_name = ${data.counted_by_name || null},
          serial_numbers = ${data.serial_numbers || null},
          lot_numbers = ${data.lot_numbers || null},
          status = 'counted',
          updated_at = NOW()
        WHERE id = ${data.line_id}
        RETURNING *
      `;
    }

    return apiResponse.success(res, result[0]);
  } catch (error) {
    log.error('Stock Take Count API error', { error, module: 'procurement:stock-takes' });
    return apiResponse.internalError(res, error);
  }
}

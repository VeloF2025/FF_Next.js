/**
 * Stock Take Lines API
 * GET /api/procurement/stock-takes/[id]/lines - List lines
 * POST /api/procurement/stock-takes/[id]/lines - Initialize lines from stock items,
 *   or add a single line ({ stock_item_id }) for stock found during the count
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Stock take ID is required');
  }

  // Verify stock take exists
  const stockTake = await sql`SELECT id, status FROM stock_takes WHERE id = ${id}`;
  if (stockTake.length === 0) {
    return apiResponse.notFound(res, 'Stock take', id);
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(id, req, res);
      case 'POST':
        if (req.body?.stock_item_id) {
          return handleAddLine(id, stockTake[0]!.status as string, String(req.body.stock_item_id), res);
        }
        return handleInitialize(id, stockTake[0]!.status as string, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
    }
  } catch (error) {
    log.error('Stock Take Lines API error', { error, module: 'procurement:stock-takes' });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(stockTakeId: string, req: NextApiRequest, res: NextApiResponse) {
  const { status, has_variance } = req.query;

  /* TODO: specify columns — v_stock_take_lines_detail is a view, result returned directly */
  let query = `SELECT * FROM v_stock_take_lines_detail WHERE stock_take_id = $1`;
  const params: string[] = [stockTakeId];
  let paramIndex = 2;

  if (status) {
    query += ` AND status = $${paramIndex}`;
    params.push(status as string);
    paramIndex++;
  }

  if (has_variance === 'true') {
    query += ` AND variance_quantity != 0`;
  }

  query += ` ORDER BY item_name`;

  const lines = await sql.query(query, params);

  return apiResponse.success(res, lines);
}

async function handleInitialize(stockTakeId: string, status: string, res: NextApiResponse) {
  // Only allow initializing draft stock takes
  if (status !== 'draft') {
    return apiResponse.badRequest(res, 'Can only initialize lines for draft stock takes');
  }

  // Call the initialize function
  const result = await sql`SELECT initialize_stock_take_lines(${stockTakeId}) as items_added`;
  const itemsAdded = result[0]!.items_added;

  return apiResponse.success(res, {
    message: `Initialized ${itemsAdded} items for counting`,
    items_added: itemsAdded
  });
}

/**
 * Add one item to an open take — for stock found during the count that wasn't
 * on the sheet (initialization only lists items with stock at the location).
 * Expected quantity comes from the location's live on-hand (usually 0 here),
 * so counting the found stock produces the correct positive variance.
 */
async function handleAddLine(
  stockTakeId: string,
  status: string,
  stockItemId: string,
  res: NextApiResponse
) {
  if (status !== 'draft' && status !== 'in_progress') {
    return apiResponse.badRequest(res, 'Can only add items to draft or in-progress stock takes');
  }

  const inserted = await sql`
    INSERT INTO stock_take_lines (
      stock_take_id, stock_item_id, location_id, warehouse_id, expected_quantity, expected_value
    )
    SELECT
      st.id,
      si.id,
      st.location_id,
      st.warehouse_id,
      COALESCE(sq.qty, 0),
      COALESCE(sq.qty, 0) * COALESCE(si.standard_cost, 0)
    FROM stock_takes st
    JOIN stock_items si ON si.id = ${stockItemId} AND si.is_active = true
    LEFT JOIN LATERAL (
      SELECT SUM(quantity) AS qty
      FROM stock_quants
      WHERE stock_item_id = si.id AND location_id = st.location_id
    ) sq ON TRUE
    WHERE st.id = ${stockTakeId}
      AND st.location_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM stock_take_lines stl
        WHERE stl.stock_take_id = st.id AND stl.stock_item_id = si.id
      )
    RETURNING id
  `;

  if (inserted.length === 0) {
    return apiResponse.badRequest(
      res,
      'Item could not be added — it may already be on the count sheet, be inactive, or the take has no location'
    );
  }

  await sql`
    UPDATE stock_takes
    SET total_items = (SELECT COUNT(*) FROM stock_take_lines WHERE stock_take_id = ${stockTakeId}),
        updated_at = NOW()
    WHERE id = ${stockTakeId}
  `;

  return apiResponse.success(res, { message: 'Item added to count sheet', line_id: inserted[0]!.id });
}

export default withAuth(handler);

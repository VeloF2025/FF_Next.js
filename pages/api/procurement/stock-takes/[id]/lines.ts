/**
 * Stock Take Lines API
 * GET /api/procurement/stock-takes/[id]/lines - List lines
 * POST /api/procurement/stock-takes/[id]/lines - Initialize lines from stock items
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

export default withAuth(handler);

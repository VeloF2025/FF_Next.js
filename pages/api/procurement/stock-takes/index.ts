/**
 * Stock Takes API - List and Create
 * GET /api/procurement/stock-takes - List all stock takes
 * POST /api/procurement/stock-takes - Create new stock take
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { StockTake, StockTakeFormData } from '@/types/procurement/stockTake.types';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    if (req.method === 'GET') {
      return handleGet(req, res);
    } else if (req.method === 'POST') {
      return handlePost(req, res);
    } else {
      return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
    }
  } catch (error) {
    log.error('Stock Takes API error', { error, module: 'procurement:stock-takes' });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { search, status, location_id, warehouse_id, category_id, project_id, stock_take_type } = req.query;

  let query = `SELECT * FROM v_stock_takes_summary WHERE 1=1`;
  const params: (string | boolean)[] = [];
  let paramIndex = 1;

  if (search) {
    query += ` AND (name ILIKE $${paramIndex} OR reference_number ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  if (status) {
    query += ` AND status = $${paramIndex}`;
    params.push(status as string);
    paramIndex++;
  }

  if (location_id) {
    query += ` AND location_id = $${paramIndex}`;
    params.push(location_id as string);
    paramIndex++;
  }

  if (warehouse_id) {
    query += ` AND warehouse_id = $${paramIndex}`;
    params.push(warehouse_id as string);
    paramIndex++;
  }

  if (category_id) {
    query += ` AND category_id = $${paramIndex}`;
    params.push(category_id as string);
    paramIndex++;
  }

  if (project_id) {
    query += ` AND project_id = $${paramIndex}`;
    params.push(project_id as string);
    paramIndex++;
  }

  if (stock_take_type) {
    query += ` AND stock_take_type = $${paramIndex}`;
    params.push(stock_take_type as string);
    paramIndex++;
  }

  query += ` ORDER BY created_at DESC`;

  const stockTakes = await sql.query(query, params) as StockTake[];

  return apiResponse.success(res, stockTakes);
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const data: StockTakeFormData = req.body;

  if (!data.name) {
    return apiResponse.badRequest(res, 'Name is required');
  }

  // Generate reference number
  const refResult = await sql`SELECT generate_stock_take_reference() as ref`;
  const referenceNumber = refResult[0]!.ref;

  // Create stock take
  const result = await sql`
    INSERT INTO stock_takes (
      reference_number,
      name,
      description,
      location_id,
      warehouse_id,
      category_id,
      project_id,
      stock_take_type,
      count_method,
      scheduled_date,
      status,
      notes,
      tags
    ) VALUES (
      ${referenceNumber},
      ${data.name},
      ${data.description || null},
      ${data.location_id || null},
      ${data.warehouse_id || null},
      ${data.category_id || null},
      ${data.project_id || null},
      ${data.stock_take_type || 'full'},
      ${data.count_method || 'blind'},
      ${data.scheduled_date || null},
      'draft',
      ${data.notes || null},
      ${data.tags || null}
    )
    RETURNING *
  `;

  return apiResponse.created(res, result[0]);
}

export default withAuth(handler);

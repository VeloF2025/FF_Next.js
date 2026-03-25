/**
 * Stock Takes API - Single Stock Take Operations
 * GET /api/procurement/stock-takes/[id] - Get stock take by ID
 * PUT /api/procurement/stock-takes/[id] - Update stock take
 * DELETE /api/procurement/stock-takes/[id] - Delete stock take
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { StockTakeFormData } from '@/types/procurement/stockTake.types';
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

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(id, res);
      case 'PUT':
        return handlePut(id, req.body, res);
      case 'DELETE':
        return handleDelete(id, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PUT', 'DELETE']);
    }
  } catch (error) {
    log.error('Stock Take API error', { error, module: 'procurement:stock-takes' });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(id: string, res: NextApiResponse) {
  // Get stock take with summary
  /* TODO: specify columns — v_stock_takes_summary is a view, result is spread to response */
  const stockTake = await sql`
    SELECT * FROM v_stock_takes_summary WHERE id = ${id}
  `;

  if (stockTake.length === 0) {
    return apiResponse.notFound(res, 'Stock take', id);
  }

  // Get lines with details
  /* TODO: specify columns — v_stock_take_lines_detail is a view, result is spread to response */
  const lines = await sql`
    SELECT * FROM v_stock_take_lines_detail
    WHERE stock_take_id = ${id}
    ORDER BY item_name
  `;

  return apiResponse.success(res, {
    ...stockTake[0],
    lines
  });
}

async function handlePut(id: string, data: StockTakeFormData & { status?: string }, res: NextApiResponse) {
  const existing = await sql`SELECT id, status FROM stock_takes WHERE id = ${id}`;

  if (existing.length === 0) {
    return apiResponse.notFound(res, 'Stock take', id);
  }

  // Prevent editing approved stock takes
  if (existing[0]!.status === 'approved' && !data.status) {
    return apiResponse.badRequest(res, 'Cannot edit approved stock take');
  }

  const result = await sql`
    UPDATE stock_takes
    SET
      name = COALESCE(${data.name}, name),
      description = COALESCE(${data.description}, description),
      location_id = COALESCE(${data.location_id}, location_id),
      warehouse_id = COALESCE(${data.warehouse_id}, warehouse_id),
      category_id = COALESCE(${data.category_id}, category_id),
      project_id = COALESCE(${data.project_id}, project_id),
      stock_take_type = COALESCE(${data.stock_take_type}, stock_take_type),
      count_method = COALESCE(${data.count_method}, count_method),
      scheduled_date = COALESCE(${data.scheduled_date}, scheduled_date),
      status = COALESCE(${data.status}, status),
      notes = COALESCE(${data.notes}, notes),
      tags = COALESCE(${data.tags}, tags),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING
      id, reference_number, name, description, status,
      location_id, warehouse_id, category_id, project_id,
      stock_take_type, count_method, scheduled_date,
      start_date, end_date, approved_at, approval_notes,
      notes, tags, created_at, updated_at
  `;

  return apiResponse.success(res, result[0]);
}

async function handleDelete(id: string, res: NextApiResponse) {
  const existing = await sql`SELECT id, status, reference_number FROM stock_takes WHERE id = ${id}`;

  if (existing.length === 0) {
    return apiResponse.notFound(res, 'Stock take', id);
  }

  // Prevent deleting approved stock takes
  if (existing[0]!.status === 'approved') {
    return apiResponse.badRequest(res, 'Cannot delete approved stock take');
  }

  // Delete (lines cascade)
  await sql`DELETE FROM stock_takes WHERE id = ${id}`;

  return apiResponse.success(res, { message: 'Stock take deleted successfully' });
}

export default withAuth(handler);

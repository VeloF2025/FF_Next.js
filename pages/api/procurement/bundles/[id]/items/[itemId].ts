/**
 * Stock Bundle Single Item API
 * GET /api/procurement/bundles/[id]/items/[itemId] - Get single item
 * PUT /api/procurement/bundles/[id]/items/[itemId] - Update item
 * DELETE /api/procurement/bundles/[id]/items/[itemId] - Remove item from bundle
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { StockBundleItemFormData } from '@/types/procurement/bundle.types';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id, itemId } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Bundle ID is required');
  }
  if (!itemId || typeof itemId !== 'string') {
    return apiResponse.badRequest(res, 'Item ID is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(itemId, res);
      case 'PUT':
        return handlePut(itemId, req.body, res);
      case 'DELETE':
        return handleDelete(id, itemId, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PUT', 'DELETE']);
    }
  } catch (error) {
    log.error('Bundle Item API error', { error, module: 'procurement:bundle-items' });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(itemId: string, res: NextApiResponse) {
  const item = await sql`
    SELECT /* TODO: specify columns */ * FROM v_stock_bundle_items_detail WHERE id = ${itemId}
  `;

  if (item.length === 0) {
    return apiResponse.notFound(res, 'Bundle item', itemId);
  }

  return apiResponse.success(res, item[0]);
}

async function handlePut(itemId: string, data: StockBundleItemFormData, res: NextApiResponse) {
  const existing = await sql`
    SELECT id FROM stock_bundle_items WHERE id = ${itemId}
  `;

  if (existing.length === 0) {
    return apiResponse.notFound(res, 'Bundle item', itemId);
  }

  const result = await sql`
    UPDATE stock_bundle_items
    SET
      quantity = COALESCE(${data.quantity}, quantity),
      uom = COALESCE(${data.uom}, uom),
      price_override = COALESCE(${data.price_override}, price_override),
      discount_percentage = COALESCE(${data.discount_percentage}, discount_percentage),
      is_optional = COALESCE(${data.is_optional}, is_optional),
      is_configurable = COALESCE(${data.is_configurable}, is_configurable),
      min_quantity = COALESCE(${data.min_quantity}, min_quantity),
      max_quantity = COALESCE(${data.max_quantity}, max_quantity),
      substitute_group = COALESCE(${data.substitute_group}, substitute_group),
      sort_order = COALESCE(${data.sort_order}, sort_order),
      notes = COALESCE(${data.notes}, notes),
      updated_at = NOW()
    WHERE id = ${itemId}
    RETURNING id, bundle_id, stock_item_id, quantity, uom, price_override,
              discount_percentage, is_optional, is_configurable, min_quantity,
              max_quantity, substitute_group, sort_order, notes, created_at, updated_at
  `;

  return apiResponse.success(res, result[0]);
}

async function handleDelete(bundleId: string, itemId: string, res: NextApiResponse) {
  const existing = await sql`
    SELECT id FROM stock_bundle_items WHERE id = ${itemId} AND bundle_id = ${bundleId}
  `;

  if (existing.length === 0) {
    return apiResponse.notFound(res, 'Bundle item', itemId);
  }

  await sql`DELETE FROM stock_bundle_items WHERE id = ${itemId}`;

  return apiResponse.success(res, { message: 'Item removed from bundle' });
}

export default withAuth(handler);

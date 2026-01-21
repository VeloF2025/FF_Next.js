/**
 * Stock Bundle Items API
 * GET /api/procurement/bundles/[id]/items - List items in bundle
 * POST /api/procurement/bundles/[id]/items - Add item to bundle
 * PUT /api/procurement/bundles/[id]/items - Bulk update items (replace all)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { StockBundleItemFormData } from '@/types/procurement/bundle.types';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Bundle ID is required');
  }

  // Verify bundle exists
  const bundle = await sql`SELECT id FROM stock_bundles WHERE id = ${id}`;
  if (bundle.length === 0) {
    return apiResponse.notFound(res, 'Bundle', id);
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(id, res);
      case 'POST':
        return handlePost(id, req.body, res);
      case 'PUT':
        return handleBulkUpdate(id, req.body, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'PUT']);
    }
  } catch (error) {
    log.error('Bundle Items API error', { error, module: 'procurement:bundle-items' });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(bundleId: string, res: NextApiResponse) {
  const items = await sql`
    SELECT * FROM v_stock_bundle_items_detail
    WHERE bundle_id = ${bundleId}
    ORDER BY sort_order, item_name
  `;

  return apiResponse.success(res, items);
}

async function handlePost(bundleId: string, data: StockBundleItemFormData, res: NextApiResponse) {
  // Validate required fields
  if (!data.stock_item_id) {
    return apiResponse.badRequest(res, 'Stock item ID is required');
  }

  // Check item exists
  const item = await sql`SELECT id FROM stock_items WHERE id = ${data.stock_item_id}`;
  if (item.length === 0) {
    return apiResponse.badRequest(res, 'Stock item not found');
  }

  // Check for duplicate
  const existing = await sql`
    SELECT id FROM stock_bundle_items
    WHERE bundle_id = ${bundleId} AND stock_item_id = ${data.stock_item_id}
  `;
  if (existing.length > 0) {
    return apiResponse.badRequest(res, 'Item already exists in this bundle');
  }

  // Get max sort order
  const maxSort = await sql`
    SELECT COALESCE(MAX(sort_order), 0) + 1 as next_sort
    FROM stock_bundle_items WHERE bundle_id = ${bundleId}
  `;

  // Insert item
  const result = await sql`
    INSERT INTO stock_bundle_items (
      bundle_id,
      stock_item_id,
      quantity,
      uom,
      price_override,
      discount_percentage,
      is_optional,
      is_configurable,
      min_quantity,
      max_quantity,
      substitute_group,
      sort_order,
      notes
    ) VALUES (
      ${bundleId},
      ${data.stock_item_id},
      ${data.quantity || 1},
      ${data.uom || null},
      ${data.price_override || null},
      ${data.discount_percentage || null},
      ${data.is_optional || false},
      ${data.is_configurable || false},
      ${data.min_quantity || null},
      ${data.max_quantity || null},
      ${data.substitute_group || null},
      ${data.sort_order ?? maxSort[0]!.next_sort},
      ${data.notes || null}
    )
    RETURNING *
  `;

  return apiResponse.created(res, result[0]);
}

async function handleBulkUpdate(
  bundleId: string,
  data: { items: StockBundleItemFormData[] },
  res: NextApiResponse
) {
  if (!data.items || !Array.isArray(data.items)) {
    return apiResponse.badRequest(res, 'Items array is required');
  }

  // Validate all items exist
  for (const item of data.items) {
    if (!item.stock_item_id) {
      return apiResponse.badRequest(res, 'Each item must have a stock_item_id');
    }
    const exists = await sql`SELECT id FROM stock_items WHERE id = ${item.stock_item_id}`;
    if (exists.length === 0) {
      return apiResponse.badRequest(res, `Stock item ${item.stock_item_id} not found`);
    }
  }

  // Delete all existing items
  await sql`DELETE FROM stock_bundle_items WHERE bundle_id = ${bundleId}`;

  // Insert new items
  const results = [];
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i]!;
    const result = await sql`
      INSERT INTO stock_bundle_items (
        bundle_id,
        stock_item_id,
        quantity,
        uom,
        price_override,
        discount_percentage,
        is_optional,
        is_configurable,
        min_quantity,
        max_quantity,
        substitute_group,
        sort_order,
        notes
      ) VALUES (
        ${bundleId},
        ${item.stock_item_id},
        ${item.quantity || 1},
        ${item.uom || null},
        ${item.price_override || null},
        ${item.discount_percentage || null},
        ${item.is_optional || false},
        ${item.is_configurable || false},
        ${item.min_quantity || null},
        ${item.max_quantity || null},
        ${item.substitute_group || null},
        ${item.sort_order ?? i + 1},
        ${item.notes || null}
      )
      RETURNING *
    `;
    results.push(result[0]);
  }

  return apiResponse.success(res, results);
}

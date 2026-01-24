/**
 * Stock Bundles API - Single Bundle Operations
 * GET /api/procurement/bundles/[id] - Get bundle by ID with items
 * PUT /api/procurement/bundles/[id] - Update bundle
 * DELETE /api/procurement/bundles/[id] - Delete bundle
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { StockBundleFormData } from '@/types/procurement/bundle.types';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Bundle ID is required');
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
    log.error('Bundle API error', { error, module: 'procurement:bundles' });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(id: string, res: NextApiResponse) {
  // Get bundle with summary data
  const bundle = await sql`
    SELECT * FROM v_stock_bundles_summary WHERE id = ${id}
  `;

  if (bundle.length === 0) {
    return apiResponse.notFound(res, 'Bundle', id);
  }

  // Get bundle items with details
  const items = await sql`
    SELECT * FROM v_stock_bundle_items_detail
    WHERE bundle_id = ${id}
    ORDER BY sort_order, item_name
  `;

  return apiResponse.success(res, {
    ...bundle[0],
    items
  });
}

async function handlePut(id: string, data: StockBundleFormData, res: NextApiResponse) {
  // Check bundle exists
  const existing = await sql`
    SELECT id, bundle_code, category_id FROM stock_bundles WHERE id = ${id}
  `;

  if (existing.length === 0) {
    return apiResponse.notFound(res, 'Bundle', id);
  }

  // Check for duplicate code (if code is being changed)
  if (data.bundle_code && data.bundle_code.toUpperCase() !== existing[0]!.bundle_code) {
    const duplicate = await sql`
      SELECT id FROM stock_bundles WHERE bundle_code = ${data.bundle_code.toUpperCase()} AND id != ${id}
    `;
    if (duplicate.length > 0) {
      return apiResponse.badRequest(res, `Bundle code '${data.bundle_code}' already exists`);
    }
  }

  // If setting as default, unset other defaults in same category
  const categoryId = data.category_id !== undefined ? data.category_id : existing[0]!.category_id;
  if (data.is_default && categoryId) {
    await sql`
      UPDATE stock_bundles SET is_default = false
      WHERE category_id = ${categoryId} AND is_default = true AND id != ${id}
    `;
  }

  // Update bundle
  const result = await sql`
    UPDATE stock_bundles
    SET
      bundle_code = COALESCE(${data.bundle_code?.toUpperCase()}, bundle_code),
      name = COALESCE(${data.name}, name),
      description = COALESCE(${data.description}, description),
      category_id = ${data.category_id === undefined ? existing[0]!.category_id : data.category_id || null},
      bundle_type = COALESCE(${data.bundle_type}, bundle_type),
      price_type = COALESCE(${data.price_type}, price_type),
      fixed_price = COALESCE(${data.fixed_price}, fixed_price),
      markup_percentage = COALESCE(${data.markup_percentage}, markup_percentage),
      is_active = COALESCE(${data.is_active}, is_active),
      is_default = COALESCE(${data.is_default}, is_default),
      allow_substitution = COALESCE(${data.allow_substitution}, allow_substitution),
      notes = COALESCE(${data.notes}, notes),
      tags = COALESCE(${data.tags}, tags),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  return apiResponse.success(res, result[0]);
}

async function handleDelete(id: string, res: NextApiResponse) {
  // Check bundle exists
  const existing = await sql`
    SELECT id, name, usage_count FROM stock_bundles WHERE id = ${id}
  `;

  if (existing.length === 0) {
    return apiResponse.notFound(res, 'Bundle', id);
  }

  // Warn if bundle has been used
  if (existing[0]!.usage_count > 0) {
    return apiResponse.badRequest(
      res,
      `Bundle '${existing[0]!.name}' has been used ${existing[0]!.usage_count} times. Consider deactivating instead of deleting.`
    );
  }

  // Delete bundle (items cascade automatically)
  await sql`DELETE FROM stock_bundles WHERE id = ${id}`;

  return apiResponse.success(res, { message: 'Bundle deleted successfully' });
}

export default withAuth(handler);

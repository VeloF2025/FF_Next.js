/**
 * Stock Categories API - Single Category Operations
 * GET /api/procurement/categories/[id] - Get category by ID
 * PUT /api/procurement/categories/[id] - Update category
 * DELETE /api/procurement/categories/[id] - Delete category
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { StockCategoryFormData } from '@/types/procurement/category.types';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Category ID is required');
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
    log.error('Category API error', { error, module: 'procurement:categories' });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(id: string, res: NextApiResponse) {
  const result = await sql`
    SELECT
      sc.*,
      pc.name as parent_name,
      pc.code as parent_code,
      (SELECT COUNT(*) FROM stock_items WHERE category_id = sc.id) as item_count,
      (SELECT COUNT(*) FROM stock_categories WHERE parent_id = sc.id) as child_count
    FROM stock_categories sc
    LEFT JOIN stock_categories pc ON sc.parent_id = pc.id
    WHERE sc.id = ${id}
  `;

  if (result.length === 0) {
    return apiResponse.notFound(res, 'Category', id);
  }

  return apiResponse.success(res, result[0]);
}

async function handlePut(id: string, data: StockCategoryFormData, res: NextApiResponse) {
  // Check category exists
  const existing = await sql`
    SELECT id, code, is_system FROM stock_categories WHERE id = ${id}
  `;

  if (existing.length === 0) {
    return apiResponse.notFound(res, 'Category', id);
  }

  // Prevent editing system category code
  if (existing[0]!.is_system && data.code && data.code.toUpperCase() !== existing[0]!.code) {
    return apiResponse.badRequest(res, 'Cannot change code of system category');
  }

  // Check for duplicate code (if code is being changed)
  if (data.code && data.code.toUpperCase() !== existing[0]!.code) {
    const duplicate = await sql`
      SELECT id FROM stock_categories WHERE code = ${data.code.toUpperCase()} AND id != ${id}
    `;
    if (duplicate.length > 0) {
      return apiResponse.badRequest(res, `Category code '${data.code}' already exists`);
    }
  }

  // Calculate new level and path if parent changed
  let level = 1;
  let path = '/' + (data.code || existing[0]!.code).toUpperCase() + '/';

  if (data.parent_id) {
    // Prevent circular reference
    if (data.parent_id === id) {
      return apiResponse.badRequest(res, 'Category cannot be its own parent');
    }

    const parent = await sql`
      SELECT level, path FROM stock_categories WHERE id = ${data.parent_id}
    `;
    if (parent.length > 0) {
      level = (parent[0]!.level as number) + 1;
      path = parent[0]!.path + (data.code || existing[0]!.code).toUpperCase() + '/';
    }
  }

  // Update category
  const result = await sql`
    UPDATE stock_categories
    SET
      code = COALESCE(${data.code?.toUpperCase()}, code),
      name = COALESCE(${data.name}, name),
      description = COALESCE(${data.description}, description),
      parent_id = ${data.parent_id === undefined ? existing[0]!.parent_id : data.parent_id || null},
      level = ${level},
      path = ${path},
      icon = COALESCE(${data.icon}, icon),
      color = COALESCE(${data.color}, color),
      sort_order = COALESCE(${data.sort_order}, sort_order),
      default_tracking_type = COALESCE(${data.default_tracking_type}, default_tracking_type),
      default_uom = COALESCE(${data.default_uom}, default_uom),
      is_active = COALESCE(${data.is_active}, is_active),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  return apiResponse.success(res, result[0]);
}

async function handleDelete(id: string, res: NextApiResponse) {
  // Check category exists
  const existing = await sql`
    SELECT id, is_system, name FROM stock_categories WHERE id = ${id}
  `;

  if (existing.length === 0) {
    return apiResponse.notFound(res, 'Category', id);
  }

  // Prevent deleting system categories
  if (existing[0]!.is_system) {
    return apiResponse.badRequest(res, `Cannot delete system category '${existing[0]!.name}'`);
  }

  // Check for child categories
  const children = await sql`
    SELECT COUNT(*) as count FROM stock_categories WHERE parent_id = ${id}
  `;
  if (parseInt(children[0]!.count as string) > 0) {
    return apiResponse.badRequest(res, 'Cannot delete category with child categories');
  }

  // Check for items using this category
  const items = await sql`
    SELECT COUNT(*) as count FROM stock_items WHERE category_id = ${id}
  `;
  if (parseInt(items[0]!.count as string) > 0) {
    return apiResponse.badRequest(
      res,
      `Cannot delete category with ${items[0]!.count} linked items. Reassign items first.`
    );
  }

  // Delete category
  await sql`DELETE FROM stock_categories WHERE id = ${id}`;

  return apiResponse.success(res, { message: 'Category deleted successfully' });
}

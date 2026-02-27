/**
 * Stock Categories API - List and Create
 * GET /api/procurement/categories - List all categories
 * POST /api/procurement/categories - Create new category
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { StockCategory, StockCategoryFormData } from '@/types/procurement/category.types';
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
    log.error('Categories API error', { error, module: 'procurement:categories' });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { search, parent_id, is_active, level, tree } = req.query;

  // Build query
  let query = `
    SELECT
      sc.*,
      pc.name as parent_name,
      pc.code as parent_code,
      (SELECT COUNT(*)::int FROM stock_items WHERE LOWER(category) = LOWER(sc.code)) as item_count
    FROM stock_categories sc
    LEFT JOIN stock_categories pc ON sc.parent_id = pc.id
    WHERE 1=1
  `;

  const params: (string | boolean | number)[] = [];
  let paramIndex = 1;

  // Apply filters
  if (search) {
    query += ` AND (sc.name ILIKE $${paramIndex} OR sc.code ILIKE $${paramIndex} OR sc.description ILIKE $${paramIndex})`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  if (parent_id) {
    if (parent_id === 'null' || parent_id === 'root') {
      query += ` AND sc.parent_id IS NULL`;
    } else {
      query += ` AND sc.parent_id = $${paramIndex}`;
      params.push(parent_id as string);
      paramIndex++;
    }
  }

  if (is_active !== undefined) {
    query += ` AND sc.is_active = $${paramIndex}`;
    params.push(is_active === 'true');
    paramIndex++;
  }

  if (level) {
    query += ` AND sc.level = $${paramIndex}`;
    params.push(parseInt(level as string));
    paramIndex++;
  }

  query += ` ORDER BY sc.level, sc.sort_order, sc.name`;

  const categories = await sql.query(query, params) as StockCategory[];

  // If tree format requested, build hierarchy
  if (tree === 'true') {
    const treeData = buildCategoryTree(categories);
    return apiResponse.success(res, treeData);
  }

  return apiResponse.success(res, categories);
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const data: StockCategoryFormData = req.body;

  // Validate required fields
  if (!data.code || !data.name) {
    return apiResponse.badRequest(res, 'Code and name are required');
  }

  // Check for duplicate code
  const existing = await sql`
    SELECT id FROM stock_categories WHERE code = ${data.code.toUpperCase()}
  `;

  if (existing.length > 0) {
    return apiResponse.badRequest(res, `Category code '${data.code}' already exists`);
  }

  // Get parent level for hierarchy
  let level = 1;
  let parentPath = '/';
  if (data.parent_id) {
    const parent = await sql`
      SELECT level, path FROM stock_categories WHERE id = ${data.parent_id}
    `;
    if (parent.length > 0) {
      level = (parent[0]!.level as number) + 1;
      parentPath = parent[0]!.path as string;
    }
  }

  const path = parentPath + data.code.toUpperCase() + '/';

  // Insert new category
  const result = await sql`
    INSERT INTO stock_categories (
      code,
      name,
      description,
      parent_id,
      level,
      path,
      icon,
      color,
      sort_order,
      default_tracking_type,
      default_uom,
      is_active
    ) VALUES (
      ${data.code.toUpperCase()},
      ${data.name},
      ${data.description || null},
      ${data.parent_id || null},
      ${level},
      ${path},
      ${data.icon || null},
      ${data.color || null},
      ${data.sort_order || 0},
      ${data.default_tracking_type || 'quantity'},
      ${data.default_uom || 'EA'},
      ${data.is_active !== false}
    )
    RETURNING *
  `;

  return apiResponse.created(res, result[0]);
}

// Build tree structure from flat list
function buildCategoryTree(categories: StockCategory[]) {
  const map = new Map<string, StockCategory & { children: StockCategory[] }>();
  const roots: (StockCategory & { children: StockCategory[] })[] = [];

  // First pass: create map entries
  categories.forEach(cat => {
    map.set(cat.id, { ...cat, children: [] });
  });

  // Second pass: build hierarchy
  categories.forEach(cat => {
    const node = map.get(cat.id)!;
    if (cat.parent_id && map.has(cat.parent_id)) {
      map.get(cat.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

export default withAuth(handler);

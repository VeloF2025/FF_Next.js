/**
 * Stock Bundles API - List and Create
 * GET /api/procurement/bundles - List all bundles
 * POST /api/procurement/bundles - Create new bundle
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import type { StockBundle, StockBundleFormData } from '@/types/procurement/bundle.types';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    if (req.method === 'GET') {
      return handleGet(req, res);
    } else if (req.method === 'POST') {
      return handlePost(req, res);
    } else {
      return apiResponse.methodNotAllowed(res);
    }
  } catch (error) {
    console.error('Bundles API error:', error);
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { search, category_id, bundle_type, is_active } = req.query;

  // Use the summary view for list with calculated prices
  let query = `
    SELECT * FROM v_stock_bundles_summary
    WHERE 1=1
  `;

  const params: (string | boolean)[] = [];
  let paramIndex = 1;

  if (search) {
    query += ` AND (name ILIKE $${paramIndex} OR bundle_code ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  if (category_id) {
    query += ` AND category_id = $${paramIndex}`;
    params.push(category_id as string);
    paramIndex++;
  }

  if (bundle_type) {
    query += ` AND bundle_type = $${paramIndex}`;
    params.push(bundle_type as string);
    paramIndex++;
  }

  if (is_active !== undefined) {
    query += ` AND is_active = $${paramIndex}`;
    params.push(is_active === 'true');
    paramIndex++;
  }

  query += ` ORDER BY is_default DESC, usage_count DESC, name`;

  const bundles = await sql(query, params) as StockBundle[];

  return apiResponse.success(res, bundles);
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const data: StockBundleFormData = req.body;

  // Validate required fields
  if (!data.bundle_code || !data.name) {
    return apiResponse.badRequest(res, 'Bundle code and name are required');
  }

  // Check for duplicate code
  const existing = await sql`
    SELECT id FROM stock_bundles WHERE bundle_code = ${data.bundle_code.toUpperCase()}
  `;

  if (existing.length > 0) {
    return apiResponse.badRequest(res, `Bundle code '${data.bundle_code}' already exists`);
  }

  // If setting as default, unset other defaults in same category
  if (data.is_default && data.category_id) {
    await sql`
      UPDATE stock_bundles SET is_default = false
      WHERE category_id = ${data.category_id} AND is_default = true
    `;
  }

  // Insert new bundle
  const result = await sql`
    INSERT INTO stock_bundles (
      bundle_code,
      name,
      description,
      category_id,
      bundle_type,
      price_type,
      fixed_price,
      markup_percentage,
      is_active,
      is_default,
      allow_substitution,
      notes,
      tags
    ) VALUES (
      ${data.bundle_code.toUpperCase()},
      ${data.name},
      ${data.description || null},
      ${data.category_id || null},
      ${data.bundle_type || 'kit'},
      ${data.price_type || 'calculated'},
      ${data.fixed_price || null},
      ${data.markup_percentage || null},
      ${data.is_active !== false},
      ${data.is_default || false},
      ${data.allow_substitution || false},
      ${data.notes || null},
      ${data.tags || null}
    )
    RETURNING *
  `;

  return apiResponse.created(res, result[0]);
}

/**
 * POST /api/procurement/stock-items
 * Creates a new entry in the stock_items catalog.
 * Used when a user types an item not found in the search and adds it on the fly.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const { name, uom, category, description, item_code } = req.body as {
    name?: string;
    uom?: string;
    category?: string;
    description?: string;
    item_code?: string;
  };

  if (!name?.trim()) {
    return apiResponse.badRequest(res, 'name is required');
  }
  if (!uom?.trim()) {
    return apiResponse.badRequest(res, 'uom is required');
  }

  // Auto-generate item_code if not provided: CUST- + 8 hex chars
  const resolvedCode = item_code?.trim() || null;

  try {
    const rows = await sql`
      INSERT INTO stock_items (item_code, name, description, category, uom, is_active)
      VALUES (
        ${resolvedCode ?? ('CUST-' + Math.random().toString(16).slice(2, 10).toUpperCase())},
        ${name.trim()},
        ${description?.trim() || null},
        ${category?.trim() || 'uncategorized'},
        ${uom.trim()},
        true
      )
      RETURNING id, item_code, name, description, category, uom, is_active
    `;

    const item = rows[0];
    log.info('Stock item created', { id: item?.id, name: item?.name }, 'stock-items');
    return apiResponse.success(res, { item });
  } catch (error) {
    log.error('Failed to create stock item', { error }, 'stock-items');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

/**
 * GET /api/procurement/stock-categories
 * Returns distinct categories from the stock_items catalog, ordered by usage count.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    const rows = await sql`
      SELECT category
      FROM stock_items
      WHERE category IS NOT NULL AND category != '' AND category != 'uncategorized'
      GROUP BY category
      ORDER BY count(*) DESC
    `;
    const categories = rows.map((r) => r.category as string);
    return apiResponse.success(res, { categories });
  } catch (error) {
    log.error('Failed to fetch stock categories', { error }, 'stock-categories');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

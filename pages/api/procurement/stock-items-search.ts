import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthenticatedNextApiRequest;
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { q, category, limit: limitStr } = req.query;
  const limit = Math.min(Number(limitStr) || 30, 100);

  try {
    let rows;

    if (q && String(q).length >= 2) {
      const search = '%' + String(q).toLowerCase() + '%';
      rows = await sql`
        SELECT id, item_code, name, description, category, uom, is_active
        FROM stock_items
        WHERE is_active = true
          AND (
            LOWER(item_code) LIKE ${search}
            OR LOWER(name) LIKE ${search}
            OR LOWER(description) LIKE ${search}
            OR LOWER(category) LIKE ${search}
          )
        ORDER BY
          CASE WHEN LOWER(item_code) LIKE ${search} THEN 0 ELSE 1 END,
          name
        LIMIT ${limit}
      `;
    } else if (category) {
      rows = await sql`
        SELECT id, item_code, name, description, category, uom, is_active
        FROM stock_items
        WHERE is_active = true
          AND LOWER(category) = LOWER(${String(category)})
        ORDER BY name
        LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT id, item_code, name, description, category, uom, is_active
        FROM stock_items
        WHERE is_active = true
        ORDER BY name
        LIMIT ${limit}
      `;
    }

    // Also return distinct categories for filter dropdown
    const categories = await sql`
      SELECT DISTINCT category
      FROM stock_items
      WHERE is_active = true AND category IS NOT NULL AND category != ''
      ORDER BY category
    `;

    return apiResponse.success(res, {
      items: rows,
      count: rows.length,
      categories: categories.map(c => c.category),
    });
  } catch (error) {
    log.error('Failed to search stock items', { error: error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

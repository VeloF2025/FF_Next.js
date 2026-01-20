/**
 * Adjustment Reasons API
 * GET /api/procurement/stock-takes/reasons - List adjustment reasons
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res);
  }

  try {
    const { adjustment_type, is_active } = req.query;

    let query = `SELECT * FROM stock_adjustment_reasons WHERE 1=1`;
    const params: (string | boolean)[] = [];
    let paramIndex = 1;

    if (adjustment_type) {
      query += ` AND (adjustment_type = $${paramIndex} OR adjustment_type = 'both')`;
      params.push(adjustment_type as string);
      paramIndex++;
    }

    if (is_active !== undefined) {
      query += ` AND is_active = $${paramIndex}`;
      params.push(is_active === 'true');
      paramIndex++;
    }

    query += ` ORDER BY sort_order, name`;

    const reasons = await sql(query, params);

    return apiResponse.success(res, reasons);
  } catch (error) {
    console.error('Adjustment Reasons API error:', error);
    return apiResponse.internalError(res, error);
  }
}

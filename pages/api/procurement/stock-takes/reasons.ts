/**
 * Adjustment Reasons API
 * GET /api/procurement/stock-takes/reasons - List adjustment reasons
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
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

    const reasons = await sql.query(query, params);

    return apiResponse.success(res, reasons);
  } catch (error) {
    log.error('Adjustment Reasons API error', { error, module: 'procurement:stock-takes' });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

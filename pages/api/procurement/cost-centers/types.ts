/**
 * Cost Center Types API
 * GET /api/procurement/cost-centers/types - List cost center types
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { is_active, hierarchy_level } = req.query;

    let query = `SELECT * FROM cost_center_types WHERE 1=1`;
    const params: (string | boolean | number)[] = [];
    let paramIndex = 1;

    if (is_active !== undefined) {
      query += ` AND is_active = $${paramIndex}`;
      params.push(is_active === 'true');
      paramIndex++;
    }

    if (hierarchy_level) {
      query += ` AND hierarchy_level = $${paramIndex}`;
      params.push(parseInt(hierarchy_level as string));
      paramIndex++;
    }

    query += ` ORDER BY hierarchy_level, sort_order`;

    const types = await sql.query(query, params);

    return apiResponse.success(res, types);
  } catch (error) {
    log.error('Cost Center Types API error', { error, module: 'procurement:cost-centers' });
    return apiResponse.internalError(res, error);
  }
}

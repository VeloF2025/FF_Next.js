/**
 * Bundle Cost Analysis Report API
 * Shows cost analysis per bundle including revenue and usage
 *
 * Query params:
 * - bundleType: Filter by bundle type
 * - minUses: Minimum usage count
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { bundleType, minUses } = req.query;

    let query = `
      SELECT
        bca.bundle_id,
        bca.bundle_code,
        bca.bundle_name,
        bca.bundle_type,
        bca.item_count,
        bca.calculated_price,
        bca.effective_price,
        bca.total_uses,
        bca.projects_used,
        bca.total_revenue
      FROM v_bundle_cost_analysis bca
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (bundleType) {
      query += ` AND bca.bundle_type = $${paramIndex}`;
      params.push(bundleType);
      paramIndex++;
    }

    if (minUses) {
      query += ` AND bca.total_uses >= $${paramIndex}`;
      params.push(parseInt(minUses as string, 10));
      paramIndex++;
    }

    query += ' ORDER BY bca.total_revenue DESC, bca.total_uses DESC';

    const rows = await sql.query(query, params);

    // Calculate summary stats
    const summary = {
      totalBundles: rows.length,
      totalRevenue: rows.reduce((sum: number, r: any) => sum + Number(r.total_revenue || 0), 0),
      totalUsageCount: rows.reduce((sum: number, r: any) => sum + (r.total_uses || 0), 0),
      avgUsesPerBundle: rows.length > 0
        ? Math.round(rows.reduce((sum: number, r: any) => sum + (r.total_uses || 0), 0) / rows.length * 10) / 10
        : 0,
      avgRevenuePerBundle: rows.length > 0
        ? Math.round(rows.reduce((sum: number, r: any) => sum + Number(r.total_revenue || 0), 0) / rows.length)
        : 0,
    };

    return apiResponse.success(res, {
      summary,
      data: rows,
    });
  } catch (error) {
    log.error('Bundle cost analysis report failed:', { data: error }, 'bundle-reports');
    return apiResponse.internalError(res, error);
  }
}

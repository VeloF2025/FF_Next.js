/**
 * Bundle Item Consumption Report API
 * Shows individual item consumption from bundles
 *
 * Query params:
 * - projectId: Filter by project
 * - bundleId: Filter by specific bundle
 * - category: Filter by item category
 * - dateFrom: Start date (YYYY-MM-DD)
 * - dateTo: End date (YYYY-MM-DD)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { projectId, bundleId, category, dateFrom, dateTo } = req.query;

    let query = `
      SELECT
        bic.project_id,
        bic.project_name,
        bic.bundle_id,
        bic.bundle_code,
        bic.bundle_name,
        bic.stock_item_id,
        bic.item_code,
        bic.item_name,
        bic.category,
        bic.qty_per_bundle,
        bic.times_bundle_used,
        bic.total_consumed,
        bic.unit_cost,
        bic.total_cost,
        bic.first_used,
        bic.last_used
      FROM v_bundle_item_consumption bic
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (projectId) {
      query += ` AND bic.project_id = $${paramIndex}`;
      params.push(projectId);
      paramIndex++;
    }

    if (bundleId) {
      query += ` AND bic.bundle_id = $${paramIndex}`;
      params.push(bundleId);
      paramIndex++;
    }

    if (category) {
      query += ` AND bic.category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    if (dateFrom) {
      query += ` AND bic.first_used >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      query += ` AND bic.last_used <= $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }

    query += ' ORDER BY bic.total_cost DESC, bic.total_consumed DESC';

    const rows = await sql.query(query, params);

    // Calculate summary stats
    const summary = {
      totalItems: rows.length,
      totalUnitsConsumed: rows.reduce((sum: number, r: any) => sum + Number(r.total_consumed || 0), 0),
      totalCost: rows.reduce((sum: number, r: any) => sum + Number(r.total_cost || 0), 0),
      uniqueItems: new Set(rows.map((r: any) => r.stock_item_id)).size,
      uniqueBundles: new Set(rows.map((r: any) => r.bundle_id)).size,
      uniqueCategories: new Set(rows.map((r: any) => r.category)).size,
    };

    // Group by category for chart data
    const byCategory = rows.reduce((acc: Record<string, { consumed: number; cost: number }>, r: any) => {
      const cat = r.category || 'Uncategorized';
      if (!acc[cat]) {
        acc[cat] = { consumed: 0, cost: 0 };
      }
      acc[cat].consumed += Number(r.total_consumed || 0);
      acc[cat].cost += Number(r.total_cost || 0);
      return acc;
    }, {});

    return apiResponse.success(res, {
      summary,
      byCategory,
      data: rows,
    });
  } catch (error) {
    log.error('Bundle consumption report failed:', { data: error }, 'bundle-reports');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

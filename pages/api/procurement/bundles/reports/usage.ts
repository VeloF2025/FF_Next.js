/**
 * Bundle Usage Report API
 * Shows how bundles are used across projects
 *
 * Query params:
 * - projectId: Filter by project
 * - bundleType: Filter by bundle type
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
    const { projectId, bundleType, dateFrom, dateTo } = req.query;

    // Build dynamic query with filters
    let query = `
      SELECT
        bu.project_id,
        bu.project_name,
        bu.bundle_id,
        bu.bundle_code,
        bu.bundle_name,
        bu.bundle_type,
        bu.times_used,
        bu.total_items_used,
        bu.bundle_price,
        bu.total_value,
        bu.first_used,
        bu.last_used
      FROM v_bundle_usage bu
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (projectId) {
      query += ` AND bu.project_id = $${paramIndex}`;
      params.push(projectId);
      paramIndex++;
    }

    if (bundleType) {
      query += ` AND bu.bundle_type = $${paramIndex}`;
      params.push(bundleType);
      paramIndex++;
    }

    if (dateFrom) {
      query += ` AND bu.first_used >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      query += ` AND bu.last_used <= $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }

    query += ' ORDER BY bu.total_value DESC, bu.times_used DESC';

    const rows = await sql.query(query, params);

    // Calculate summary stats
    const summary = {
      totalBundlesUsed: rows.length,
      totalUsageCount: rows.reduce((sum: number, r: any) => sum + (r.times_used || 0), 0),
      totalItemsConsumed: rows.reduce((sum: number, r: any) => sum + (r.total_items_used || 0), 0),
      totalValue: rows.reduce((sum: number, r: any) => sum + Number(r.total_value || 0), 0),
      uniqueProjects: new Set(rows.map((r: any) => r.project_id)).size,
    };

    return apiResponse.success(res, {
      summary,
      data: rows,
    });
  } catch (error) {
    log.error('Bundle usage report failed:', { data: error }, 'bundle-reports');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

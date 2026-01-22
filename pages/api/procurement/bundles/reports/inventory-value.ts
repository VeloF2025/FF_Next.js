/**
 * Bundle Inventory Value Report API
 * Shows total value of bundles by project/location
 *
 * Query params:
 * - projectId: Filter by project
 * - bundleType: Filter by bundle type
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
    const { projectId, bundleType } = req.query;

    let query = `
      SELECT
        biv.project_id,
        biv.project_name,
        biv.bundle_type,
        biv.unique_bundles,
        biv.bundle_instances,
        biv.total_value
      FROM v_bundle_inventory_value biv
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (projectId) {
      query += ` AND biv.project_id = $${paramIndex}`;
      params.push(projectId);
      paramIndex++;
    }

    if (bundleType) {
      query += ` AND biv.bundle_type = $${paramIndex}`;
      params.push(bundleType);
      paramIndex++;
    }

    query += ' ORDER BY biv.total_value DESC';

    const rows = await sql.query(query, params);

    // Calculate summary stats
    const summary = {
      totalProjects: new Set(rows.map((r: any) => r.project_id)).size,
      totalUniqueBundles: rows.reduce((sum: number, r: any) => sum + (r.unique_bundles || 0), 0),
      totalInstances: rows.reduce((sum: number, r: any) => sum + (r.bundle_instances || 0), 0),
      totalValue: rows.reduce((sum: number, r: any) => sum + Number(r.total_value || 0), 0),
    };

    // Group by bundle type for chart data
    const byType = rows.reduce((acc: Record<string, { bundles: number; instances: number; value: number }>, r: any) => {
      const type = r.bundle_type || 'other';
      if (!acc[type]) {
        acc[type] = { bundles: 0, instances: 0, value: 0 };
      }
      acc[type].bundles += r.unique_bundles || 0;
      acc[type].instances += r.bundle_instances || 0;
      acc[type].value += Number(r.total_value || 0);
      return acc;
    }, {});

    // Group by project for chart data
    const byProject = rows.reduce((acc: Record<string, { name: string; value: number }>, r: any) => {
      const pid = r.project_id || 'unassigned';
      if (!acc[pid]) {
        acc[pid] = { name: r.project_name || 'Unassigned', value: 0 };
      }
      acc[pid].value += Number(r.total_value || 0);
      return acc;
    }, {});

    return apiResponse.success(res, {
      summary,
      byType,
      byProject,
      data: rows,
    });
  } catch (error) {
    log.error('Bundle inventory value report failed:', { data: error }, 'bundle-reports');
    return apiResponse.internalError(res, error);
  }
}

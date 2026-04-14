/**
 * Project Procurement Summaries API
 * Returns procurement metrics per project (BOQ value, active RFQs, pending POs, stock alerts)
 * UPDATED: Real database queries instead of mock data
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { ProjectSummary } from '../../../../src/types/procurement/portal.types';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    // Query projects with procurement metrics
    const projectSummaries = await sql`
      SELECT
        p.id as project_id,
        p.project_name,
        p.project_code,
        p.status,

        -- BOQ Value: Sum of all BOQ items for this project
        COALESCE((
          SELECT SUM(bi.total_price)
          FROM boq_items bi
          JOIN boqs b ON bi.boq_id = b.id
          WHERE b.project_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND b.project_id::uuid = p.id
        ), 0) as boq_value,

        -- Active RFQs: Count of non-closed/cancelled RFQs
        COALESCE((
          SELECT COUNT(*)
          FROM rfqs r
          WHERE r.project_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND r.project_id::uuid = p.id
          AND r.status NOT IN ('closed', 'cancelled', 'awarded')
        ), 0) as active_rfqs,

        -- Pending POs: Count of POs awaiting action
        COALESCE((
          SELECT COUNT(*)
          FROM purchase_orders po
          WHERE po.project_id = p.id
          AND po.status IN ('draft', 'pending_approval', 'approved')
        ), 0) as pending_pos,

        -- Stock Alerts: Items below min stock level for this project
        COALESCE((
          SELECT COUNT(*)
          FROM stock_quants sq
          JOIN stock_items si ON sq.stock_item_id = si.id
          WHERE sq.project_id = p.id
          AND sq.quantity < COALESCE(si.min_stock_level, 0)
          AND si.min_stock_level > 0
        ), 0) as stock_alerts

      FROM projects p
      WHERE p.status = 'active'
      ORDER BY p.project_name
    `;

    // Map to ProjectSummary type
    const summaries: ProjectSummary[] = projectSummaries.map(row => ({
      projectId: row.project_id,
      projectName: row.project_name,
      projectCode: row.project_code || row.project_id.substring(0, 8).toUpperCase(),
      boqValue: parseFloat(row.boq_value) || 0,
      activeRFQs: parseInt(row.active_rfqs) || 0,
      pendingPOs: parseInt(row.pending_pos) || 0,
      stockAlerts: parseInt(row.stock_alerts) || 0,
      status: row.status || 'active',
    }));

    return apiResponse.success(res, summaries);
  } catch (error) {
    log.error('Error fetching project summaries:', { error: error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

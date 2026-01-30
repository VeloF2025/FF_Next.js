// WORKING: Procurement Aggregate Metrics API
// Returns real metrics across all projects for the procurement portal overview
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
    // Run all metric queries in parallel
    const [
      projectCounts,
      boqMetrics,
      rfqMetrics,
      poMetrics,
      stockMetrics,
      supplierMetrics,
      approvalMetrics,
      projectSummaries
    ] = await Promise.all([
      // Total active projects
      sql`SELECT
        COUNT(*)::int as total_projects,
        COUNT(*) FILTER (WHERE status = 'active')::int as active_projects
        FROM projects`,

      // BOQ value
      sql`SELECT
        COALESCE(SUM(total_value), 0)::numeric as total_boq_value,
        COUNT(*)::int as total_boqs,
        COUNT(*) FILTER (WHERE status IN ('draft', 'review'))::int as active_boqs
        FROM boqs`,

      // RFQ metrics
      sql`SELECT
        COUNT(*)::int as total_rfqs,
        COUNT(*) FILTER (WHERE status = 'open')::int as active_rfqs,
        COUNT(*) FILTER (WHERE status = 'closed')::int as closed_rfqs
        FROM rfqs`,

      // Purchase order metrics
      sql`SELECT
        COUNT(*)::int as total_pos,
        COUNT(*) FILTER (WHERE status = 'pending')::int as pending_pos,
        COUNT(*) FILTER (WHERE status = 'approved')::int as approved_pos,
        COALESCE(SUM(total_amount), 0)::numeric as total_po_value
        FROM purchase_orders`,

      // Stock metrics
      sql`SELECT
        COUNT(*)::int as total_stock_items,
        COUNT(*) FILTER (WHERE quantity <= min_stock_level AND min_stock_level > 0)::int as low_stock_items
        FROM stock_items`,

      // Supplier metrics
      sql`SELECT
        COUNT(DISTINCT id)::int as total_suppliers
        FROM suppliers WHERE is_active = true`,

      // Pending approvals
      sql`SELECT
        COUNT(*)::int as pending_approvals
        FROM purchase_orders WHERE status = 'pending'`,

      // Per-project summaries (top 20 active projects)
      sql`SELECT
        p.id,
        p.project_name as name,
        p.project_code as code,
        p.status,
        COALESCE(boq.total_value, 0)::numeric as boq_value,
        COALESCE(rfq.active_count, 0)::int as active_rfqs,
        COALESCE(po.pending_count, 0)::int as pending_pos,
        COALESCE(stock_alerts.low_count, 0)::int as stock_alerts,
        p.actual_progress as completion_percentage
      FROM projects p
      LEFT JOIN LATERAL (
        SELECT SUM(total_value) as total_value
        FROM boqs WHERE project_id = p.id::text
      ) boq ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) as active_count
        FROM rfqs WHERE project_id = p.id::text AND status = 'open'
      ) rfq ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) as pending_count
        FROM purchase_orders WHERE project_id = p.id::text AND status = 'pending'
      ) po ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) as low_count
        FROM stock_items WHERE quantity <= min_stock_level AND min_stock_level > 0
      ) stock_alerts ON true
      WHERE p.status = 'active'
      ORDER BY p.project_name
      LIMIT 20`
    ]);

    const metrics = {
      totalProjects: projectCounts[0]?.total_projects || 0,
      activeProjects: projectCounts[0]?.active_projects || 0,
      totalBOQValue: Number(boqMetrics[0]?.total_boq_value || 0),
      totalBOQs: boqMetrics[0]?.total_boqs || 0,
      activeBOQs: boqMetrics[0]?.active_boqs || 0,
      totalActiveRFQs: rfqMetrics[0]?.active_rfqs || 0,
      totalRFQs: rfqMetrics[0]?.total_rfqs || 0,
      closedRFQs: rfqMetrics[0]?.closed_rfqs || 0,
      totalPurchaseOrders: poMetrics[0]?.total_pos || 0,
      pendingPOs: poMetrics[0]?.pending_pos || 0,
      approvedPOs: poMetrics[0]?.approved_pos || 0,
      totalPOValue: Number(poMetrics[0]?.total_po_value || 0),
      totalStockItems: stockMetrics[0]?.total_stock_items || 0,
      lowStockItems: stockMetrics[0]?.low_stock_items || 0,
      totalSuppliers: supplierMetrics[0]?.total_suppliers || 0,
      pendingApprovals: approvalMetrics[0]?.pending_approvals || 0,
    };

    const summaries = projectSummaries.map((p: Record<string, unknown>) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      status: p.status,
      boqValue: Number(p.boq_value || 0),
      activeRFQs: p.active_rfqs || 0,
      pendingPOs: p.pending_pos || 0,
      stockAlerts: p.stock_alerts || 0,
      completionPercentage: p.completion_percentage || 0,
    }));

    return apiResponse.success(res, {
      metrics,
      projectSummaries: summaries,
    });
  } catch (error) {
    log.error('Failed to fetch aggregate metrics', { data: error }, 'procurement/aggregate-metrics');
    return apiResponse.error(res, 'Failed to fetch aggregate metrics');
  }
}

export default withAuth(handler);

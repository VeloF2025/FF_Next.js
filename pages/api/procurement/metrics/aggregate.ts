/**
 * Aggregate Procurement Metrics API
 * Returns overall procurement KPIs across all projects
 * UPDATED: Real database queries instead of mock data
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { AggregateProjectMetrics } from '../../../../src/types/procurement/portal.types';
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
    // Get aggregate metrics from multiple sources (all independent, run in parallel)
    const [
      projectCount,
      boqTotal,
      rfqCount,
      poCount,
      stockItemCount,
      supplierCount,
      costSavings,
      cycleTime,
      supplierOTIF,
      monthlyVolume,
    ] = await Promise.all([
      // Count active projects
      sql`SELECT COUNT(*) as total FROM projects WHERE status = 'active'`,

      // Total BOQ Value across all projects
      sql`SELECT COALESCE(
        NULLIF(
          (SELECT SUM(bi.total_price) FROM boq_items bi
           JOIN boqs b ON bi.boq_id = b.id
           WHERE b.status != 'archived'),
          0
        ),
        (SELECT SUM(total_estimated_value) FROM boqs WHERE status != 'archived'),
        0
      ) as total_value`,

      // Active RFQs count
      sql`SELECT COUNT(*) as total
      FROM rfqs r
      WHERE r.status NOT IN ('closed', 'cancelled', 'awarded')`,

      // Total Purchase Orders count
      sql`SELECT COUNT(*) as total FROM purchase_orders`,

      // Total Stock Items count
      sql`SELECT COUNT(*) as total FROM stock_items WHERE is_active = true`,

      // Total Suppliers count
      sql`SELECT COUNT(*) as total FROM suppliers WHERE status = 'active'`,

      // Calculate average cost savings (comparison of RFQ estimates vs awarded amounts)
      sql`SELECT
        CASE
          WHEN SUM(r.total_budget_estimate) > 0 THEN
            ROUND(
              (1 - SUM(COALESCE(po.total_amount, 0)) / NULLIF(SUM(r.total_budget_estimate), 0)) * 100,
              1
            )
          ELSE 0
        END as savings_percent
      FROM rfqs r
      LEFT JOIN purchase_orders po ON po.rfq_id = r.id
      WHERE r.status = 'awarded'
      AND r.total_budget_estimate > 0`,

      // Calculate average cycle time (days from RFQ creation to PO creation)
      sql`SELECT
        COALESCE(
          AVG(EXTRACT(DAY FROM (po.created_at - r.created_at))),
          0
        )::numeric as avg_days
      FROM rfqs r
      JOIN purchase_orders po ON po.rfq_id = r.id
      WHERE r.status = 'awarded'`,

      // Calculate supplier OTIF (On-Time In-Full) - based on GRN data
      sql`SELECT
        CASE
          WHEN COUNT(*) > 0 THEN
            ROUND(
              COUNT(CASE
                WHEN grn.delivery_date <= po.expected_delivery_date
                AND grn.inspection_status = 'passed'
                THEN 1
              END)::NUMERIC / COUNT(*)::NUMERIC * 100,
              0
            )
          ELSE 0
        END as otif_percent
      FROM goods_receipt_notes grn
      JOIN purchase_orders po ON grn.purchase_order_id = po.id
      WHERE grn.status = 'completed'`,

      // Monthly procurement volume (last 30 days)
      sql`SELECT COALESCE(SUM(total_amount), 0) as volume
      FROM purchase_orders
      WHERE created_at >= NOW() - INTERVAL '30 days'
      AND status NOT IN ('draft', 'cancelled')`,
    ]);

    const metrics: AggregateProjectMetrics = {
      totalProjects: parseInt(projectCount[0]?.total) || 0,
      totalBOQValue: parseFloat(boqTotal[0]?.total_value) || 0,
      totalActiveRFQs: parseInt(rfqCount[0]?.total) || 0,
      totalPurchaseOrders: parseInt(poCount[0]?.total) || 0,
      totalStockItems: parseInt(stockItemCount[0]?.total) || 0,
      totalSuppliers: parseInt(supplierCount[0]?.total) || 0,
      averageCostSavings: parseFloat(costSavings[0]?.savings_percent) || 0,
      averageCycleDays: parseFloat(cycleTime[0]?.avg_days) || 0,
      averageSupplierOTIF: parseInt(supplierOTIF[0]?.otif_percent) || 0,
      monthlyProcurementVolume: {
        currency: 'ZAR',
        value: parseFloat(monthlyVolume[0]?.volume) || 0,
      },
    };

    return apiResponse.success(res, metrics);
  } catch (error) {
    log.error('Error fetching aggregate metrics:', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

/**
 * Procurement Reports Data API
 * Returns real spend-by-category and cycle-time metrics from the database
 */
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
    const results = await Promise.allSettled([
      // Spend by category from BOQ items (most populated source)
      sql`SELECT
        COALESCE(NULLIF(TRIM(bi.category), ''), 'Uncategorized') as category,
        COUNT(*)::int as item_count,
        COALESCE(SUM(bi.total_price), 0)::numeric as total_spend
      FROM boq_items bi
      JOIN boqs b ON bi.boq_id = b.id
      WHERE b.status != 'archived'
      GROUP BY COALESCE(NULLIF(TRIM(bi.category), ''), 'Uncategorized')
      ORDER BY total_spend DESC`,

      // Total BOQ spend (for percentage calculation)
      sql`SELECT COALESCE(SUM(bi.total_price), 0)::numeric as grand_total
      FROM boq_items bi
      JOIN boqs b ON bi.boq_id = b.id
      WHERE b.status != 'archived'`,

      // Cycle time: Requisition → RFQ (avg days)
      sql`SELECT
        COALESCE(AVG(EXTRACT(DAY FROM (r.created_at - pr.created_at))), 0)::numeric as avg_days,
        COALESCE(MIN(EXTRACT(DAY FROM (r.created_at - pr.created_at))), 0)::int as min_days,
        COALESCE(MAX(EXTRACT(DAY FROM (r.created_at - pr.created_at))), 0)::int as max_days,
        COUNT(*)::int as sample_count
      FROM rfqs r
      JOIN purchase_requisitions pr ON r.requisition_id = pr.id
      WHERE r.requisition_id IS NOT NULL`,

      // Cycle time: RFQ → PO (avg days)
      sql`SELECT
        COALESCE(AVG(EXTRACT(DAY FROM (po.created_at - r.created_at))), 0)::numeric as avg_days,
        COALESCE(MIN(EXTRACT(DAY FROM (po.created_at - r.created_at))), 0)::int as min_days,
        COALESCE(MAX(EXTRACT(DAY FROM (po.created_at - r.created_at))), 0)::int as max_days,
        COUNT(*)::int as sample_count
      FROM purchase_orders po
      JOIN rfqs r ON po.rfq_id = r.id
      WHERE po.rfq_id IS NOT NULL`,

      // Cycle time: PO → Delivery (avg days)
      sql`SELECT
        COALESCE(AVG(EXTRACT(DAY FROM (grn.delivery_date - po.created_at))), 0)::numeric as avg_days,
        COALESCE(MIN(EXTRACT(DAY FROM (grn.delivery_date - po.created_at))), 0)::int as min_days,
        COALESCE(MAX(EXTRACT(DAY FROM (grn.delivery_date - po.created_at))), 0)::int as max_days,
        COUNT(*)::int as sample_count
      FROM goods_receipt_notes grn
      JOIN purchase_orders po ON grn.purchase_order_id = po.id
      WHERE grn.delivery_date IS NOT NULL
        AND grn.status = 'completed'`,

      // Cycle time: GRN processing (delivery_date to created_at of GRN)
      sql`SELECT
        COALESCE(AVG(ABS(EXTRACT(DAY FROM (grn.created_at - grn.delivery_date)))), 0)::numeric as avg_days,
        COALESCE(MIN(ABS(EXTRACT(DAY FROM (grn.created_at - grn.delivery_date)))), 0)::int as min_days,
        COALESCE(MAX(ABS(EXTRACT(DAY FROM (grn.created_at - grn.delivery_date)))), 0)::int as max_days,
        COUNT(*)::int as sample_count
      FROM goods_receipt_notes grn
      WHERE grn.delivery_date IS NOT NULL
        AND grn.status = 'completed'`,

      // Overall end-to-end cycle time (PO creation to GRN completion)
      sql`SELECT
        COALESCE(AVG(EXTRACT(DAY FROM (grn.delivery_date - po.created_at))), 0)::numeric as avg_total_days
      FROM goods_receipt_notes grn
      JOIN purchase_orders po ON grn.purchase_order_id = po.id
      WHERE grn.delivery_date IS NOT NULL
        AND grn.status = 'completed'`,
    ]);

    const failedQueries = results
      .map((r, i) => r.status === 'rejected' ? { index: i, reason: String(r.reason) } : null)
      .filter(Boolean);

    if (failedQueries.length > 0) {
      log.error('Reports data: some queries failed', { data: failedQueries }, 'procurement/reports-data');
    }

    const getValue = (idx: number) => results[idx]?.status === 'fulfilled' ? results[idx].value : [];

    const spendRows = getValue(0);
    const grandTotalRow = getValue(1);
    const reqToRfq = getValue(2);
    const rfqToPo = getValue(3);
    const poToDelivery = getValue(4);
    const grnProcessing = getValue(5);
    const overallCycle = getValue(6);

    const grandTotal = Number(grandTotalRow[0]?.grand_total || 0);

    // Format spend by category with real percentages
    const spendByCategory = spendRows.map((row: Record<string, unknown>) => {
      const amount = Number(row.total_spend || 0);
      return {
        category: row.category as string,
        amount,
        percentage: grandTotal > 0 ? Math.round((amount / grandTotal) * 100) : 0,
        itemCount: Number(row.item_count || 0),
      };
    });

    // Build cycle metrics from real timestamp diffs
    const formatCycleRow = (row: Record<string, unknown>[], stage: string) => {
      const r = row[0] || {};
      const avg = Math.round(Number(r.avg_days || 0));
      return {
        stage,
        avgDays: avg,
        minDays: Number(r.min_days || 0),
        maxDays: Number(r.max_days || 0),
        sampleCount: Number(r.sample_count || 0),
      };
    };

    const cycleMetrics = [
      formatCycleRow(reqToRfq, 'Requisition to RFQ'),
      formatCycleRow(rfqToPo, 'RFQ to Purchase Order'),
      formatCycleRow(poToDelivery, 'PO to Delivery'),
      formatCycleRow(grnProcessing, 'GRN Processing'),
    ];

    const avgTotalCycleDays = Math.round(Number(overallCycle[0]?.avg_total_days || 0));

    return apiResponse.success(res, {
      spendByCategory,
      cycleMetrics,
      avgTotalCycleDays,
    });
  } catch (error) {
    log.error('Failed to fetch reports data', { data: error }, 'procurement/reports-data');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

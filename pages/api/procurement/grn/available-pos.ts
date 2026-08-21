// WORKING: Available POs for GRN creation — shows all POs with GRN receipt status
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';

const sql = neon(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  // Fetch all POs that could receive goods (exclude draft, cancelled)
  // Include GRN receipt info: how many GRNs, total qty ordered vs received
  const rows = await sql`
    SELECT
      po.id,
      po.po_number,
      po.status,
      po.supplier_id,
      COALESCE(s.company_name, s.name, 'Unknown') as supplier_name,
      ordered_agg.item_count,
      grn_agg.grn_count,
      ordered_agg.total_ordered,
      grn_agg.total_received
    FROM purchase_orders po
    LEFT JOIN suppliers s ON po.supplier_id = s.id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS item_count,
        COALESCE(SUM(quantity_ordered), 0)::numeric AS total_ordered
      FROM purchase_order_items WHERE purchase_order_id = po.id
    ) ordered_agg ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        COUNT(DISTINCT grn.id)::int AS grn_count,
        COALESCE(SUM(gri.quantity_received), 0)::numeric AS total_received
      FROM goods_receipt_notes grn
      LEFT JOIN goods_receipt_items gri ON gri.grn_id = grn.id
      WHERE grn.purchase_order_id = po.id
        -- grn_count now excludes cancelled/rejected GRNs, which the previous
        -- COUNT(*) did not while total_received always did. A PO whose only
        -- receipt was cancelled therefore reads as never-received instead of
        -- part-received. Verified data-identical across all 621 live rows on
        -- 2026-08-21 (no PO currently has only cancelled receipts); the change
        -- only shows up once someone cancels a GRN.
        AND grn.status NOT IN ('cancelled', 'rejected')
    ) grn_agg ON TRUE
    WHERE po.status NOT IN ('draft', 'cancelled')
    -- Part-received POs first: they have stock physically waiting to be booked
    -- in, and they are the only ones a clerk returns to a second time. They used
    -- to rank BELOW every untouched PO, which put PO-2026-0237 at position 347
    -- of 621 and read to the user as the order having been deleted.
    -- Ranking is by received quantity, not po.status, so a stale status column
    -- cannot bury an order that still has stock outstanding.
    ORDER BY
      CASE
        WHEN grn_agg.grn_count > 0 AND ordered_agg.total_ordered > grn_agg.total_received THEN 0
        WHEN grn_agg.grn_count > 0 THEN 2
        ELSE 1
      END,
      po.created_at DESC
  `;

  const data = rows.map((r: Record<string, unknown>) => ({
    id: r.id,
    poNumber: r.po_number,
    status: r.status,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    itemCount: Number(r.item_count) || 0,
    grnCount: Number(r.grn_count) || 0,
    totalOrdered: Number(r.total_ordered) || 0,
    totalReceived: Number(r.total_received) || 0,
  }));

  return apiResponse.success(res, data);
}));

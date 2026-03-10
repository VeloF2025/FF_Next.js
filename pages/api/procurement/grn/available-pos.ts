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
      (SELECT COUNT(*)::int FROM purchase_order_items WHERE purchase_order_id = po.id) as item_count,
      (SELECT COUNT(*)::int FROM goods_receipt_notes WHERE purchase_order_id = po.id) as grn_count,
      COALESCE((SELECT SUM(quantity_ordered) FROM purchase_order_items WHERE purchase_order_id = po.id), 0)::numeric as total_ordered,
      COALESCE((
        SELECT SUM(gri.quantity_received)
        FROM goods_receipt_items gri
        JOIN goods_receipt_notes grn ON grn.id = gri.goods_receipt_id
        WHERE grn.purchase_order_id = po.id
          AND grn.status NOT IN ('cancelled', 'rejected')
      ), 0)::numeric as total_received
    FROM purchase_orders po
    LEFT JOIN suppliers s ON po.supplier_id = s.id
    WHERE po.status NOT IN ('draft', 'cancelled')
    ORDER BY
      CASE
        WHEN po.status IN ('approved', 'sent', 'acknowledged') THEN 0
        WHEN po.status = 'partially_received' THEN 1
        ELSE 2
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

/**
 * GET /api/projects/[projectId]/boq-utilization
 *
 * Returns BOQ utilization data for a project:
 * - Per-line: boq_qty, ordered_qty, received_qty, outstanding_qty
 * - Summary: total value, ordered %, received %
 * - Non-BOQ items: ad-hoc PO items not linked to any BOQ line
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';
import type {
  BOQLineUtilization,
  BOQUtilizationResponse,
  BOQUtilizationSummary,
  NonBOQItem,
} from '@/types/procurement/boq-utilization.types';

// Re-export types for consumers that can import from this route
export type { BOQLineUtilization, NonBOQItem, BOQUtilizationSummary, BOQUtilizationResponse } from '@/types/procurement/boq-utilization.types';

const sql = neon(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { projectId } = req.query;
  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.validationError(res, { projectId: 'Project ID is required' });
  }

  // BOQ line utilization — aggregate ordered + received quantities per BOQ line
  const lines = await sql`
    SELECT
      bi.id,
      bi.boq_id,
      bi.line_number,
      bi.item_code,
      bi.description,
      COALESCE(bi.uom, 'units') AS uom,
      bi.quantity AS boq_qty,
      bi.unit_price,
      bi.total_price AS boq_value,
      COALESCE(SUM(poi.quantity_ordered), 0) AS ordered_qty,
      COALESCE(SUM(gri.quantity_accepted), 0) AS received_qty,
      bi.quantity - COALESCE(SUM(poi.quantity_ordered), 0) AS outstanding_qty,
      COALESCE(SUM(poi.quantity_ordered * poi.unit_price), 0) AS ordered_value
    FROM boq_items bi
    JOIN boqs b ON bi.boq_id = b.id
    LEFT JOIN purchase_order_items poi ON poi.boq_item_id = bi.id
    LEFT JOIN goods_receipt_items gri ON gri.po_item_id = poi.id
    WHERE b.project_id = ${projectId}
      AND b.status NOT IN ('superseded', 'archived', 'cancelled')
      AND (bi.item_code IS NULL OR bi.item_code != 'TOTAL')
    GROUP BY bi.id, bi.boq_id, bi.line_number, bi.item_code, bi.description,
             bi.uom, bi.quantity, bi.unit_price, bi.total_price
    ORDER BY bi.line_number NULLS LAST, bi.description
  `;

  // Non-BOQ PO items for this project
  const nonBoqRows = await sql`
    SELECT
      poi.id,
      poi.item_code,
      poi.item_description,
      poi.quantity_ordered,
      poi.quantity_received,
      poi.unit_price,
      poi.total_price,
      po.po_number,
      po.id AS po_id
    FROM purchase_order_items poi
    JOIN purchase_orders po ON poi.purchase_order_id = po.id
    WHERE po.project_id = ${projectId}
      AND poi.boq_item_id IS NULL
      AND po.status NOT IN ('cancelled')
    ORDER BY po.order_date DESC, poi.item_description
  `;

  // Build typed response
  const typedLines: BOQLineUtilization[] = lines.map((r) => {
    const orderedQty = Number(r.ordered_qty);
    const boqQty = Number(r.boq_qty);
    let status: BOQLineUtilization['status'] = 'not_ordered';
    if (orderedQty > boqQty) status = 'over_ordered';
    else if (orderedQty >= boqQty) status = 'fully_ordered';
    else if (orderedQty > 0) status = 'partial';

    return {
      id: r.id as string,
      boqId: r.boq_id as string,
      lineNumber: r.line_number as number | null,
      itemCode: r.item_code as string | null,
      description: r.description as string,
      uom: r.uom as string,
      boqQty,
      orderedQty,
      receivedQty: Number(r.received_qty),
      outstandingQty: Number(r.outstanding_qty),
      unitPrice: r.unit_price ? Number(r.unit_price) : null,
      boqValue: r.boq_value ? Number(r.boq_value) : null,
      orderedValue: Number(r.ordered_value),
      status,
    };
  });

  const typedNonBoq: NonBOQItem[] = nonBoqRows.map((r) => ({
    id: r.id as string,
    itemCode: r.item_code as string | null,
    itemDescription: r.item_description as string,
    quantityOrdered: Number(r.quantity_ordered),
    quantityReceived: Number(r.quantity_received),
    unitPrice: Number(r.unit_price),
    totalPrice: r.total_price ? Number(r.total_price) : null,
    poNumber: r.po_number as string,
    poId: r.po_id as string,
  }));

  const totalBoqValue = typedLines.reduce((s, l) => s + (l.boqValue ?? 0), 0);
  const totalOrderedValue = typedLines.reduce((s, l) => s + (l.orderedValue ?? 0), 0);
  const totalReceivedValue = typedLines.reduce((s, l) => s + l.receivedQty * (l.unitPrice ?? 0), 0);

  const summary: BOQUtilizationSummary = {
    totalBoqValue,
    totalOrderedValue,
    totalReceivedValue,
    orderedPercent: totalBoqValue > 0 ? Math.round((totalOrderedValue / totalBoqValue) * 100) : 0,
    receivedPercent: totalBoqValue > 0 ? Math.round((totalReceivedValue / totalBoqValue) * 100) : 0,
    boqLineCount: typedLines.length,
    orderedLineCount: typedLines.filter((l) => l.orderedQty > 0).length,
    nonBoqItemCount: typedNonBoq.length,
  };

  const result: BOQUtilizationResponse = {
    summary,
    lines: typedLines,
    nonBoqItems: typedNonBoq,
  };

  return apiResponse.success(res, result);
}));

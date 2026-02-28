/**
 * GET /api/procurement/boq-lifecycle?boqId=xxx
 *
 * Returns full procurement lifecycle data for a BOQ:
 * - Per-line: ordered, received, invoiced, paid values
 * - Linked POs, GRNs, and invoices for click-through
 * - Summary KPI totals and percentages
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';
import { log } from '@/lib/logger';
import type {
  BOQLifecycleLine,
  BOQLifecycleResponse,
  BOQLifecycleSummary,
  LifecycleStatus,
  LinkedPO,
  LinkedGRN,
  LinkedInvoice,
} from '@/types/procurement/boq-lifecycle.types';

const sql = neon(process.env.DATABASE_URL!);

function deriveStatus(line: {
  orderedQty: number;
  receivedQty: number;
  boqQty: number;
  invoicedValue: number;
  paidValue: number;
}): LifecycleStatus {
  if (line.paidValue > 0 && line.invoicedValue > 0 && line.paidValue >= line.invoicedValue) return 'paid';
  if (line.paidValue > 0) return 'partially_paid';
  if (line.invoicedValue > 0) return 'invoiced';
  if (line.receivedQty > 0 && line.receivedQty >= line.boqQty) return 'delivered';
  if (line.receivedQty > 0) return 'partially_delivered';
  if (line.orderedQty > 0) return 'ordered';
  return 'not_started';
}

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { boqId } = req.query;
  if (!boqId || typeof boqId !== 'string') {
    return apiResponse.validationError(res, { boqId: 'BOQ ID is required' });
  }

  // Main aggregation query — 4 LEFT JOIN subqueries for ordered/received/invoiced/paid
  const rows = await sql`
    SELECT
      bi.id AS boq_item_id,
      bi.item_code,
      bi.description,
      COALESCE(bi.uom, 'units') AS uom,
      bi.quantity AS boq_qty,
      COALESCE(bi.total_price, bi.quantity * bi.unit_price) AS boq_value,
      bi.unit_price,
      COALESCE(po_agg.total_ordered_qty, 0) AS ordered_qty,
      COALESCE(po_agg.total_ordered_value, 0) AS ordered_value,
      COALESCE(grn_agg.total_received_qty, 0) AS received_qty,
      COALESCE(inv_agg.total_invoiced, 0) AS invoiced_value,
      COALESCE(paid_agg.total_paid, 0) AS paid_value
    FROM boq_items bi
    JOIN boqs b ON bi.boq_id = b.id
    LEFT JOIN (
      SELECT
        poi.boq_item_id,
        SUM(poi.quantity_ordered) AS total_ordered_qty,
        SUM(poi.quantity_ordered * poi.unit_price) AS total_ordered_value
      FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id = poi.purchase_order_id
      WHERE poi.boq_item_id IS NOT NULL
        AND po.status NOT IN ('cancelled')
      GROUP BY poi.boq_item_id
    ) po_agg ON po_agg.boq_item_id = bi.id
    LEFT JOIN (
      SELECT
        poi.boq_item_id,
        SUM(gri.quantity_accepted) AS total_received_qty
      FROM goods_receipt_items gri
      JOIN purchase_order_items poi ON gri.po_item_id = poi.id
      JOIN purchase_orders po ON po.id = poi.purchase_order_id
      JOIN goods_receipt_notes grn ON gri.grn_id = grn.id
      WHERE poi.boq_item_id IS NOT NULL
        AND po.status NOT IN ('cancelled')
        AND grn.status = 'completed'
      GROUP BY poi.boq_item_id
    ) grn_agg ON grn_agg.boq_item_id = bi.id
    LEFT JOIN (
      SELECT
        poi.boq_item_id,
        SUM(sii.line_total) AS total_invoiced
      FROM supplier_invoice_items sii
      JOIN purchase_order_items poi ON sii.po_item_id = poi.id
      JOIN supplier_invoices si ON si.id = sii.supplier_invoice_id
      WHERE poi.boq_item_id IS NOT NULL
        AND si.status NOT IN ('cancelled', 'disputed')
      GROUP BY poi.boq_item_id
    ) inv_agg ON inv_agg.boq_item_id = bi.id
    LEFT JOIN (
      SELECT
        poi.boq_item_id,
        SUM(
          sii.line_total * LEAST(
            CASE WHEN si.total_amount > 0
              THEN si.amount_paid / si.total_amount
              ELSE 0
            END,
            1
          )
        ) AS total_paid
      FROM supplier_invoice_items sii
      JOIN purchase_order_items poi ON sii.po_item_id = poi.id
      JOIN supplier_invoices si ON si.id = sii.supplier_invoice_id
      WHERE poi.boq_item_id IS NOT NULL
        AND si.status NOT IN ('cancelled', 'disputed')
        AND si.amount_paid > 0
      GROUP BY poi.boq_item_id
    ) paid_agg ON paid_agg.boq_item_id = bi.id
    WHERE bi.boq_id = ${boqId}
      AND (bi.item_code IS NULL OR bi.item_code != 'TOTAL')
    ORDER BY bi.line_number NULLS LAST, bi.description
  `;

  // Collect boqItemIds that have procurement activity for linked entity queries
  const activeItemIds = rows
    .filter((r) => Number(r.ordered_qty) > 0 || Number(r.invoiced_value) > 0)
    .map((r) => r.boq_item_id as string);

  // Fetch linked entities in parallel (only if there are active items)
  const poMap = new Map<string, LinkedPO[]>();
  const grnMap = new Map<string, LinkedGRN[]>();
  const invMap = new Map<string, LinkedInvoice[]>();

  if (activeItemIds.length > 0) {
    const [poRows, grnRows, invRows] = await Promise.all([
      sql`
        SELECT
          poi.boq_item_id,
          po.id,
          po.po_number,
          SUM(poi.quantity_ordered) AS qty,
          SUM(poi.quantity_ordered * poi.unit_price) AS value,
          po.status
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.purchase_order_id
        WHERE poi.boq_item_id = ANY(${activeItemIds}::uuid[])
          AND po.status NOT IN ('cancelled')
        GROUP BY poi.boq_item_id, po.id, po.po_number, po.status
        ORDER BY po.po_number
      `,
      sql`
        SELECT
          poi.boq_item_id,
          grn.id,
          grn.grn_number,
          SUM(gri.quantity_accepted) AS qty,
          grn.status
        FROM goods_receipt_items gri
        JOIN purchase_order_items poi ON gri.po_item_id = poi.id
        JOIN goods_receipt_notes grn ON gri.grn_id = grn.id
        WHERE poi.boq_item_id = ANY(${activeItemIds}::uuid[])
          AND grn.status = 'completed'
        GROUP BY poi.boq_item_id, grn.id, grn.grn_number, grn.status
        ORDER BY grn.grn_number
      `,
      sql`
        SELECT
          poi.boq_item_id,
          si.id,
          si.invoice_number,
          SUM(sii.line_total) AS invoiced,
          SUM(
            sii.line_total * LEAST(
              CASE WHEN si.total_amount > 0
                THEN si.amount_paid / si.total_amount
                ELSE 0
              END,
              1
            )
          ) AS paid,
          si.status
        FROM supplier_invoice_items sii
        JOIN purchase_order_items poi ON sii.po_item_id = poi.id
        JOIN supplier_invoices si ON si.id = sii.supplier_invoice_id
        WHERE poi.boq_item_id = ANY(${activeItemIds}::uuid[])
          AND si.status NOT IN ('cancelled', 'disputed')
        GROUP BY poi.boq_item_id, si.id, si.invoice_number, si.status
        ORDER BY si.invoice_number
      `,
    ]);

    // Group into maps by boqItemId
    for (const r of poRows) {
      const key = r.boq_item_id as string;
      if (!poMap.has(key)) poMap.set(key, []);
      poMap.get(key)!.push({
        id: r.id as string,
        poNumber: r.po_number as string,
        orderedQty: Number(r.qty),
        orderedValue: Number(r.value),
        status: r.status as string,
      });
    }
    for (const r of grnRows) {
      const key = r.boq_item_id as string;
      if (!grnMap.has(key)) grnMap.set(key, []);
      grnMap.get(key)!.push({
        id: r.id as string,
        grnNumber: r.grn_number as string,
        receivedQty: Number(r.qty),
        status: r.status as string,
      });
    }
    for (const r of invRows) {
      const key = r.boq_item_id as string;
      if (!invMap.has(key)) invMap.set(key, []);
      invMap.get(key)!.push({
        id: r.id as string,
        invoiceNumber: r.invoice_number as string,
        invoicedValue: Number(r.invoiced),
        paidValue: Number(r.paid),
        status: r.status as string,
      });
    }
  }

  // Build typed lines
  const lines: BOQLifecycleLine[] = rows.map((r) => {
    const boqItemId = r.boq_item_id as string;
    const boqQty = Number(r.boq_qty);
    const orderedQty = Number(r.ordered_qty);
    const receivedQty = Number(r.received_qty);
    const unitPrice = Number(r.unit_price) || 0;
    const boqValue = Number(r.boq_value) || 0;
    const orderedValue = Number(r.ordered_value);
    const receivedValue = receivedQty * unitPrice;
    const invoicedValue = Number(r.invoiced_value);
    const paidValue = Number(r.paid_value);

    return {
      boqItemId,
      itemCode: r.item_code as string | null,
      description: r.description as string,
      uom: r.uom as string,
      boqQty,
      boqValue,
      orderedQty,
      orderedValue,
      receivedQty,
      receivedValue,
      invoicedValue,
      paidValue,
      lifecycleStatus: deriveStatus({ orderedQty, receivedQty, boqQty, invoicedValue, paidValue }),
      linkedPOs: poMap.get(boqItemId) ?? [],
      linkedGRNs: grnMap.get(boqItemId) ?? [],
      linkedInvoices: invMap.get(boqItemId) ?? [],
    };
  });

  // Summary
  const totalBoqValue = lines.reduce((s, l) => s + l.boqValue, 0);
  const totalOrderedValue = lines.reduce((s, l) => s + l.orderedValue, 0);
  const totalReceivedValue = lines.reduce((s, l) => s + l.receivedValue, 0);
  const totalInvoicedValue = lines.reduce((s, l) => s + l.invoicedValue, 0);
  const totalPaidValue = lines.reduce((s, l) => s + l.paidValue, 0);

  const pct = (part: number) => totalBoqValue > 0 ? Math.round((part / totalBoqValue) * 100) : 0;

  const summary: BOQLifecycleSummary = {
    totalBoqValue,
    totalOrderedValue,
    totalReceivedValue,
    totalInvoicedValue,
    totalPaidValue,
    orderedPercent: pct(totalOrderedValue),
    receivedPercent: pct(totalReceivedValue),
    invoicedPercent: pct(totalInvoicedValue),
    paidPercent: pct(totalPaidValue),
  };

  log.info('BOQ lifecycle loaded', { boqId, lines: lines.length }, 'boq-lifecycle');

  const result: BOQLifecycleResponse = { summary, lines };
  return apiResponse.success(res, result);
}));

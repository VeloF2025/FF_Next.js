/**
 * BOQ Utilization CSV Export
 * GET /api/projects/[projectId]/boq-utilization-export
 *
 * Exports BOQ lines + non-BOQ items with summary totals.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { escapeCSV, sendCSV } from '@/lib/csv';

const sql = neon(process.env.DATABASE_URL!);

const BOM = '\uFEFF';
const HEADERS = ['Item Code', 'Description', 'UOM', 'BOQ Qty', 'Ordered Qty', 'Received Qty', 'Outstanding Qty', 'Unit Price', 'BOQ Value', 'Ordered Value', 'Status'];

function computeStatus(boqQty: number, orderedQty: number, receivedQty: number): string {
  if (receivedQty >= boqQty && boqQty > 0) return 'Received';
  if (receivedQty > 0) return 'Partially Received';
  if (orderedQty > boqQty) return 'Over Ordered';
  if (orderedQty >= boqQty) return 'Fully Ordered';
  if (orderedQty > 0) return 'Partial';
  return 'Not Ordered';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  const { projectId } = req.query;
  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  try {
    const lines = await sql`
      SELECT
        bi.item_code, bi.description, COALESCE(bi.uom, 'units') AS uom,
        bi.quantity AS boq_qty, bi.unit_price, bi.total_price AS boq_value,
        COALESCE(po_agg.total_ordered, 0) AS ordered_qty,
        COALESCE(grn_agg.total_received, 0) AS received_qty,
        bi.quantity - COALESCE(po_agg.total_ordered, 0) AS outstanding_qty,
        COALESCE(po_agg.total_ordered_value, 0) AS ordered_value
      FROM boq_items bi
      JOIN boqs b ON bi.boq_id = b.id
      LEFT JOIN (
        SELECT poi.boq_item_id,
          SUM(poi.quantity_ordered) AS total_ordered,
          SUM(poi.quantity_ordered * poi.unit_price) AS total_ordered_value
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.purchase_order_id
        WHERE poi.boq_item_id IS NOT NULL AND po.status NOT IN ('cancelled')
        GROUP BY poi.boq_item_id
      ) po_agg ON po_agg.boq_item_id = bi.id
      LEFT JOIN (
        SELECT poi.boq_item_id,
          SUM(gri.quantity_accepted) AS total_received
        FROM goods_receipt_items gri
        JOIN purchase_order_items poi ON gri.po_item_id = poi.id
        JOIN purchase_orders po ON po.id = poi.purchase_order_id
        JOIN goods_receipt_notes grn ON gri.grn_id = grn.id
        WHERE poi.boq_item_id IS NOT NULL AND po.status NOT IN ('cancelled') AND grn.status = 'completed'
        GROUP BY poi.boq_item_id
      ) grn_agg ON grn_agg.boq_item_id = bi.id
      WHERE b.project_id = ${projectId}
        AND b.status NOT IN ('superseded', 'archived', 'cancelled')
        AND (bi.item_code IS NULL OR bi.item_code != 'TOTAL')
      ORDER BY bi.line_number NULLS LAST, bi.description
    `;

    const nonBoqRows = await sql`
      SELECT poi.item_code, poi.item_description, poi.quantity_ordered,
        poi.quantity_received, poi.unit_price, poi.total_price, po.po_number
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      WHERE po.project_id = ${projectId}
        AND poi.boq_item_id IS NULL AND po.status NOT IN ('cancelled')
      ORDER BY po.order_date DESC, poi.item_description
    `;

    // Build CSV manually for BOQ + non-BOQ sections
    const csvLines: string[] = [HEADERS.map(h => escapeCSV(h)).join(',')];

    let totalBoqValue = 0;
    let totalOrderedValue = 0;

    for (const r of lines) {
      const boqQty = Number(r.boq_qty);
      const orderedQty = Number(r.ordered_qty);
      const receivedQty = Number(r.received_qty);
      const outstandingQty = Number(r.outstanding_qty);
      const unitPrice = r.unit_price ? Number(r.unit_price) : 0;
      const boqValue = r.boq_value ? Number(r.boq_value) : 0;
      const orderedValue = Number(r.ordered_value);

      totalBoqValue += boqValue;
      totalOrderedValue += orderedValue;

      csvLines.push([
        escapeCSV(r.item_code || ''),
        escapeCSV(r.description),
        escapeCSV(r.uom),
        boqQty, orderedQty, receivedQty, outstandingQty,
        unitPrice.toFixed(2), boqValue.toFixed(2), orderedValue.toFixed(2),
        escapeCSV(computeStatus(boqQty, orderedQty, receivedQty)),
      ].join(','));
    }

    // Totals row
    csvLines.push([
      escapeCSV(''), escapeCSV('TOTALS'), escapeCSV(''),
      '', '', '', '',
      '', totalBoqValue.toFixed(2), totalOrderedValue.toFixed(2), '',
    ].join(','));

    // Non-BOQ section
    if (nonBoqRows.length > 0) {
      csvLines.push('');
      csvLines.push(escapeCSV('Non-BOQ Items') + ',,,,,,,,,,');

      for (const r of nonBoqRows) {
        csvLines.push([
          escapeCSV(r.item_code || ''),
          escapeCSV(r.item_description),
          escapeCSV(''),
          Number(r.quantity_ordered), '', Number(r.quantity_received), '',
          r.unit_price ? Number(r.unit_price).toFixed(2) : '',
          r.total_price ? Number(r.total_price).toFixed(2) : '',
          '', escapeCSV(r.po_number),
        ].join(','));
      }
    }

    const csv = BOM + csvLines.join('\n');
    const filename = `boq-utilization-${new Date().toISOString().split('T')[0]}.csv`;
    return sendCSV(res, csv, filename);
  } catch (err) {
    log.error('Failed to export BOQ utilization', { error: err }, 'boq-export');
    return apiResponse.internalError(res, err, 'Failed to export BOQ utilization');
  }
}

export default withAuth(withErrorHandler(handler));

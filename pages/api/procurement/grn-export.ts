/**
 * GRN Register CSV Export
 * GET — export goods receipt notes as CSV
 *
 * Query params: poId, status
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { buildCSV, sendCSV, type CSVColumn } from '@/lib/csv';

const sql = neon(process.env.DATABASE_URL!);

const columns: CSVColumn[] = [
  { key: 'grnNumber', label: 'GRN Number' },
  { key: 'poNumber', label: 'PO Number' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'warehouse', label: 'Warehouse' },
  { key: 'deliveryDate', label: 'Delivery Date' },
  { key: 'status', label: 'Status' },
  { key: 'totalItems', label: 'Total Items' },
  { key: 'qtyReceived', label: 'Qty Received' },
  { key: 'qtyRejected', label: 'Qty Rejected' },
  { key: 'hasDiscrepancy', label: 'Has Discrepancy' },
  { key: 'inspectionStatus', label: 'Inspection Status' },
  { key: 'receivedBy', label: 'Received By' },
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  try {
    const { poId, status } = req.query;

    // Explicit query branches — no conditional SQL fragments
    let rows;
    if (poId && status) {
      rows = await sql`
        SELECT grn.grn_number, po.po_number,
          COALESCE(s.company_name, s.name) as supplier_name,
          sl.name as warehouse_name, grn.delivery_date, grn.status,
          grn.total_items, grn.total_quantity_received, grn.total_quantity_rejected,
          grn.has_discrepancy, grn.inspection_status, grn.received_by_name
        FROM goods_receipt_notes grn
        LEFT JOIN purchase_orders po ON grn.purchase_order_id = po.id
        LEFT JOIN suppliers s ON grn.supplier_id = s.id
        LEFT JOIN stock_locations sl ON grn.warehouse_id = sl.id
        WHERE grn.purchase_order_id = ${poId as string}
          AND grn.status = ${status as string}
        ORDER BY grn.created_at DESC
        LIMIT 10000
      `;
    } else if (poId) {
      rows = await sql`
        SELECT grn.grn_number, po.po_number,
          COALESCE(s.company_name, s.name) as supplier_name,
          sl.name as warehouse_name, grn.delivery_date, grn.status,
          grn.total_items, grn.total_quantity_received, grn.total_quantity_rejected,
          grn.has_discrepancy, grn.inspection_status, grn.received_by_name
        FROM goods_receipt_notes grn
        LEFT JOIN purchase_orders po ON grn.purchase_order_id = po.id
        LEFT JOIN suppliers s ON grn.supplier_id = s.id
        LEFT JOIN stock_locations sl ON grn.warehouse_id = sl.id
        WHERE grn.purchase_order_id = ${poId as string}
        ORDER BY grn.created_at DESC
        LIMIT 10000
      `;
    } else if (status) {
      rows = await sql`
        SELECT grn.grn_number, po.po_number,
          COALESCE(s.company_name, s.name) as supplier_name,
          sl.name as warehouse_name, grn.delivery_date, grn.status,
          grn.total_items, grn.total_quantity_received, grn.total_quantity_rejected,
          grn.has_discrepancy, grn.inspection_status, grn.received_by_name
        FROM goods_receipt_notes grn
        LEFT JOIN purchase_orders po ON grn.purchase_order_id = po.id
        LEFT JOIN suppliers s ON grn.supplier_id = s.id
        LEFT JOIN stock_locations sl ON grn.warehouse_id = sl.id
        WHERE grn.status = ${status as string}
        ORDER BY grn.created_at DESC
        LIMIT 10000
      `;
    } else {
      rows = await sql`
        SELECT grn.grn_number, po.po_number,
          COALESCE(s.company_name, s.name) as supplier_name,
          sl.name as warehouse_name, grn.delivery_date, grn.status,
          grn.total_items, grn.total_quantity_received, grn.total_quantity_rejected,
          grn.has_discrepancy, grn.inspection_status, grn.received_by_name
        FROM goods_receipt_notes grn
        LEFT JOIN purchase_orders po ON grn.purchase_order_id = po.id
        LEFT JOIN suppliers s ON grn.supplier_id = s.id
        LEFT JOIN stock_locations sl ON grn.warehouse_id = sl.id
        ORDER BY grn.created_at DESC
        LIMIT 10000
      `;
    }

    const mapped = rows.map((r: Record<string, unknown>) => ({
      grnNumber: r.grn_number,
      poNumber: r.po_number || '',
      supplier: r.supplier_name || '',
      warehouse: r.warehouse_name || '',
      deliveryDate: r.delivery_date || '',
      status: r.status,
      totalItems: Number(r.total_items) || 0,
      qtyReceived: Number(r.total_quantity_received) || 0,
      qtyRejected: Number(r.total_quantity_rejected) || 0,
      hasDiscrepancy: r.has_discrepancy ? 'Yes' : 'No',
      inspectionStatus: r.inspection_status || 'N/A',
      receivedBy: r.received_by_name || '',
    }));

    const csv = buildCSV(columns, mapped);
    const filename = `grn-register-${new Date().toISOString().split('T')[0]}.csv`;
    return sendCSV(res, csv, filename);
  } catch (err) {
    log.error('Failed to export GRNs', { error: err }, 'grn-export');
    return apiResponse.internalError(res, err, 'Failed to export GRNs');
  }
}

export default withAuth(withErrorHandler(handler));

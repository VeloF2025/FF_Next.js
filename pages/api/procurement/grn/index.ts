import type { NextApiRequest, NextApiResponse } from 'next';
import type { GoodsReceiptNote, GRNListItem } from '@/types/procurement/grn.types';
import { withErrorHandler } from '@/lib/api-error-handler';
import { neon } from '@neondatabase/serverless';
import { logCreate } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const userId = (req as AuthenticatedNextApiRequest).user.id;

  if (req.method === 'GET') {
    try {
      const { page = '1', limit = '50' } = req.query;
      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const offset = (pageNum - 1) * limitNum;

      // Get GRNs with related info (simple query without filters for now)
      const grns = await sql`
        SELECT
          grn.*,
          po.po_number as purchase_order_number,
          COALESCE(s.company_name, s.name) as supplier_name,
          sl.name as warehouse_name
        FROM goods_receipt_notes grn
        LEFT JOIN purchase_orders po ON grn.purchase_order_id = po.id
        LEFT JOIN suppliers s ON grn.supplier_id = s.id
        LEFT JOIN stock_locations sl ON grn.warehouse_id = sl.id
        ORDER BY grn.created_at DESC
        LIMIT ${limitNum} OFFSET ${offset}
      `;

      // Get total count
      const countResult = await sql`
        SELECT COUNT(*)::int as total
        FROM goods_receipt_notes grn
      `;

      // Transform to list items
      const items: GRNListItem[] = grns.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        grnNumber: r.grn_number as string,
        purchaseOrderNumber: r.purchase_order_number as string | undefined,
        supplierName: r.supplier_name as string | undefined,
        warehouseName: r.warehouse_name as string | undefined,
        deliveryDate: r.delivery_date as string,
        status: r.status as GoodsReceiptNote['status'],
        totalItems: Number(r.total_items),
        totalQuantityReceived: Number(r.total_quantity_received),
        totalQuantityRejected: Number(r.total_quantity_rejected),
        hasDiscrepancy: r.has_discrepancy as boolean,
        inspectionStatus: r.inspection_status as GoodsReceiptNote['inspectionStatus'],
        receivedByName: r.received_by_name as string | undefined,
        createdAt: r.created_at as string,
      }));

      return apiResponse.paginated(
        res,
        items,
        {
          page: parseInt(page as string),
          pageSize: parseInt(limit as string),
          total: countResult[0]!.total,
        }
      );
    } catch (error) {
      return apiResponse.databaseError(res, error, 'Failed to fetch GRNs');
    }
  } else if (req.method === 'POST') {
    try {
      const body = req.body;

      // Validate required fields
      if (!body.supplierId) {
        return apiResponse.validationError(res, { supplierId: 'Supplier is required' });
      }
      if (!body.warehouseId) {
        return apiResponse.validationError(res, { warehouseId: 'Warehouse is required' });
      }
      if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
        return apiResponse.validationError(res, { items: 'At least one item is required' });
      }

      // Insert GRN
      const [grn] = await sql`
        INSERT INTO goods_receipt_notes (
          purchase_order_id,
          supplier_id,
          delivery_note_number,
          carrier,
          vehicle_number,
          warehouse_id,
          receiving_bay,
          inspection_required,
          received_by,
          received_by_name,
          notes,
          status
        ) VALUES (
          ${body.purchaseOrderId || null},
          ${body.supplierId},
          ${body.deliveryNoteNumber || null},
          ${body.carrier || null},
          ${body.vehicleNumber || null},
          ${body.warehouseId},
          ${body.receivingBay || null},
          ${body.inspectionRequired || false},
          ${userId || 'system'},
          ${body.receivedByName || 'System User'},
          ${body.notes || null},
          'draft'
        )
        RETURNING *
      `;

      // Insert items
      for (const item of body.items) {
        await sql`
          INSERT INTO goods_receipt_items (
            grn_id,
            po_item_id,
            stock_item_id,
            item_code,
            item_description,
            quantity_expected,
            quantity_received,
            quantity_rejected,
            uom,
            serial_numbers,
            lot_number,
            batch_number,
            manufacture_date,
            expiry_date,
            location_id,
            bin_location,
            unit_cost,
            notes
          ) VALUES (
            ${grn!.id},
            ${item.poItemId || null},
            ${item.stockItemId || null},
            ${item.itemCode || null},
            ${item.itemDescription || null},
            ${item.quantityExpected || null},
            ${item.quantityReceived},
            ${item.quantityRejected || 0},
            ${item.uom},
            ${item.serialNumbers ? JSON.stringify(item.serialNumbers) : null},
            ${item.lotNumber || null},
            ${item.batchNumber || null},
            ${item.manufactureDate || null},
            ${item.expiryDate || null},
            ${item.locationId || null},
            ${item.binLocation || null},
            ${item.unitCost || null},
            ${item.notes || null}
          )
        `;
      }

      // Log creation
      logCreate('goods_receipt_note', grn!.id, {
        grn_number: grn!.grn_number,
        supplier_id: grn!.supplier_id,
        items_count: body.items.length,
      });

      return apiResponse.created(res, grn!, 'Goods receipt note created successfully');
    } catch (error) {
      return apiResponse.databaseError(res, error, 'Failed to create GRN');
    }
  } else {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
  }
}));

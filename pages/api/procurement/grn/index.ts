import type { NextApiRequest, NextApiResponse } from 'next';
import type { GoodsReceiptNote, GRNListItem } from '@/types/procurement/grn.types';
import { withErrorHandler } from '@/lib/api-error-handler';
import { neon } from '@neondatabase/serverless';
import { logCreate } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { createAuditLog } from '@/services/procurement/auditService';
import { transaction } from '@/lib/db-pool';

const sql = neon(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const userId = (req as AuthenticatedNextApiRequest).user.id;

  if (req.method === 'GET') {
    try {
      const { page = '1', limit = '50', poId } = req.query;
      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const offset = (pageNum - 1) * limitNum;

      // Get GRNs with related info, optionally filtered by PO
      const grns = poId
        ? await sql`
            SELECT
              grn.*,
              po.po_number as purchase_order_number,
              COALESCE(s.company_name, s.name) as supplier_name,
              sl.name as warehouse_name
            FROM goods_receipt_notes grn
            LEFT JOIN purchase_orders po ON grn.purchase_order_id = po.id
            LEFT JOIN suppliers s ON grn.supplier_id = s.id
            LEFT JOIN stock_locations sl ON grn.warehouse_id = sl.id
            WHERE grn.purchase_order_id = ${poId as string}
            ORDER BY grn.created_at DESC
            LIMIT ${limitNum} OFFSET ${offset}
          `
        : await sql`
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
      const countResult = poId
        ? await sql`
            SELECT COUNT(*)::int as total
            FROM goods_receipt_notes grn
            WHERE grn.purchase_order_id = ${poId as string}
          `
        : await sql`
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
      log.error('Failed to fetch GRNs', { error: { error } }, 'IndexApi');
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

      // A receipt line only reaches stock if it carries a stock_item_id: both
      // postGrnReceiptLines and the stock trigger key on it, and skip the line
      // when it is null. The receive screen doesn't send one — it builds lines
      // from the PO, and available-pos never exposed the field — so goods were
      // being "received" into nothing. Take it from the PO line, which is the
      // authoritative link, rather than trusting whatever the client posted.
      const poItemIds = body.items
        .map((i: { poItemId?: string }) => i.poItemId)
        .filter((id: string | undefined): id is string => Boolean(id));
      const stockItemByPoItem = new Map<string, string>();
      if (poItemIds.length > 0) {
        const poLines = await sql`
          SELECT id, stock_item_id
            FROM purchase_order_items
           WHERE id = ANY(${poItemIds}::uuid[]) AND stock_item_id IS NOT NULL
        `;
        for (const row of poLines as Record<string, unknown>[]) {
          stockItemByPoItem.set(row.id as string, row.stock_item_id as string);
        }
      }

      // Header and items go in together or not at all — a failing line must not
      // leave an item-less GRN behind (that is how GRN26-00326/00327 happened).
      const grn = await transaction(async (txn) => {
        const created = await txn.queryOne(
          `INSERT INTO goods_receipt_notes (
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
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft')
          RETURNING *`,
          [
            body.purchaseOrderId || null,
            body.supplierId,
            body.deliveryNoteNumber || null,
            body.carrier || null,
            body.vehicleNumber || null,
            body.warehouseId,
            body.receivingBay || null,
            body.inspectionRequired || false,
            userId || 'system',
            body.receivedByName || 'System User',
            body.notes || null,
          ]
        );

        for (const item of body.items) {
          await txn.query(
            `INSERT INTO goods_receipt_items (
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
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
            [
              created!.id,
              item.poItemId || null,
              item.stockItemId
                || (item.poItemId ? stockItemByPoItem.get(item.poItemId) ?? null : null),
              item.itemCode || null,
              item.itemDescription || null,
              item.quantityExpected || null,
              item.quantityReceived,
              item.quantityRejected || 0,
              item.uom,
              item.serialNumbers ? JSON.stringify(item.serialNumbers) : null,
              item.lotNumber || null,
              item.batchNumber || null,
              item.manufactureDate || null,
              item.expiryDate || null,
              item.locationId || null,
              item.binLocation || null,
              item.unitCost || null,
              item.notes || null,
            ]
          );
        }

        return created;
      });

      // Log creation
      logCreate('goods_receipt_note', grn!.id as string, {
        grn_number: grn!.grn_number,
        supplier_id: grn!.supplier_id,
        items_count: body.items.length,
      });

      createAuditLog({
        entityType: 'goods_receipt',
        entityId: grn!.id as string,
        action: 'create',
        performedBy: userId,
        newValues: { grnNumber: grn!.grn_number, supplierId: body.supplierId },
      });

      return apiResponse.created(res, grn!, 'Goods receipt note created successfully');
    } catch (error) {
      log.error('Failed to create GRN', { error: { error } }, 'IndexApi');
      return apiResponse.databaseError(res, error, 'Failed to create GRN');
    }
  } else {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
  }
}));

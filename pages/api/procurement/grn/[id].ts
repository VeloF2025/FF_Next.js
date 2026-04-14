// WORKING: GRN Detail API - GET, PATCH, DELETE
// PRD-050 Phase 2: Core Procurement
import type { NextApiRequest, NextApiResponse } from 'next';
import type { GoodsReceiptNote, GoodsReceiptItem } from '@/types/procurement/grn.types';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql, logUpdate, logDelete } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const { id } = req.query;
  const userId = (req as AuthenticatedNextApiRequest).user.id;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'GRN ID is required');
  }

  if (req.method === 'GET') {
    try {
      // Get GRN with related info
      const [grn] = await sql`
        SELECT
          grn.id, grn.grn_number, grn.purchase_order_id, grn.supplier_id,
          grn.delivery_date, grn.delivery_note_number, grn.carrier, grn.vehicle_number,
          grn.warehouse_id, grn.receiving_bay, grn.status,
          grn.inspection_required, grn.inspected_by, grn.inspected_at,
          grn.inspection_status, grn.inspection_notes,
          grn.total_items, grn.total_quantity_expected, grn.total_quantity_received,
          grn.total_quantity_rejected,
          grn.has_discrepancy, grn.discrepancy_notes, grn.discrepancy_resolved,
          grn.discrepancy_resolved_by, grn.discrepancy_resolved_at,
          grn.received_by, grn.received_by_name, grn.verified_by, grn.verified_at,
          grn.notes, grn.created_at, grn.updated_at,
          po.po_number as purchase_order_number,
          COALESCE(s.company_name, s.name) as supplier_name,
          sl.name as warehouse_name
        FROM goods_receipt_notes grn
        LEFT JOIN purchase_orders po ON grn.purchase_order_id = po.id
        LEFT JOIN suppliers s ON grn.supplier_id = s.id
        LEFT JOIN stock_locations sl ON grn.warehouse_id = sl.id
        WHERE grn.id = ${id}
      `;

      if (!grn) {
        return apiResponse.notFound(res, 'Goods Receipt Note', id);
      }

      // Get items
      const items = await sql`
        SELECT
          id, grn_id, po_item_id, stock_item_id, item_code, item_description,
          quantity_expected, quantity_received, quantity_rejected, uom,
          serial_numbers, lot_number, batch_number, manufacture_date, expiry_date,
          location_id, bin_location, inspection_status, rejection_reason, rejection_code,
          unit_cost, total_cost, notes, created_at
        FROM goods_receipt_items
        WHERE grn_id = ${id}
        ORDER BY created_at
      `;

      // Transform to response format
      const result: GoodsReceiptNote = {
        id: grn.id,
        grnNumber: grn.grn_number,
        purchaseOrderId: grn.purchase_order_id,
        purchaseOrderNumber: grn.purchase_order_number,
        supplierId: grn.supplier_id,
        supplierName: grn.supplier_name,
        deliveryDate: grn.delivery_date,
        deliveryNoteNumber: grn.delivery_note_number,
        carrier: grn.carrier,
        vehicleNumber: grn.vehicle_number,
        warehouseId: grn.warehouse_id,
        warehouseName: grn.warehouse_name,
        receivingBay: grn.receiving_bay,
        status: grn.status,
        inspectionRequired: grn.inspection_required,
        inspectedBy: grn.inspected_by,
        inspectedAt: grn.inspected_at,
        inspectionStatus: grn.inspection_status,
        inspectionNotes: grn.inspection_notes,
        totalItems: Number(grn.total_items),
        totalQuantityExpected: Number(grn.total_quantity_expected || 0),
        totalQuantityReceived: Number(grn.total_quantity_received),
        totalQuantityRejected: Number(grn.total_quantity_rejected),
        hasDiscrepancy: grn.has_discrepancy,
        discrepancyNotes: grn.discrepancy_notes,
        discrepancyResolved: grn.discrepancy_resolved,
        discrepancyResolvedBy: grn.discrepancy_resolved_by,
        discrepancyResolvedAt: grn.discrepancy_resolved_at,
        receivedBy: grn.received_by,
        receivedByName: grn.received_by_name,
        verifiedBy: grn.verified_by,
        verifiedAt: grn.verified_at,
        notes: grn.notes,
        items: items.map((item: Record<string, unknown>): GoodsReceiptItem => ({
          id: item.id as string,
          grnId: item.grn_id as string,
          poItemId: item.po_item_id as string | undefined,
          stockItemId: item.stock_item_id as string | undefined,
          itemCode: item.item_code as string | undefined,
          itemDescription: item.item_description as string | undefined,
          quantityExpected: item.quantity_expected ? Number(item.quantity_expected) : undefined,
          quantityReceived: Number(item.quantity_received),
          quantityRejected: Number(item.quantity_rejected),
          quantityAccepted: Number(item.quantity_received) - Number(item.quantity_rejected),
          uom: item.uom as string,
          serialNumbers: item.serial_numbers ? JSON.parse(item.serial_numbers as string) : undefined,
          lotNumber: item.lot_number as string | undefined,
          batchNumber: item.batch_number as string | undefined,
          manufactureDate: item.manufacture_date as string | undefined,
          expiryDate: item.expiry_date as string | undefined,
          locationId: item.location_id as string | undefined,
          binLocation: item.bin_location as string | undefined,
          inspectionStatus: item.inspection_status as GoodsReceiptItem['inspectionStatus'],
          rejectionReason: item.rejection_reason as string | undefined,
          rejectionCode: item.rejection_code as string | undefined,
          unitCost: item.unit_cost ? Number(item.unit_cost) : undefined,
          totalCost: item.total_cost ? Number(item.total_cost) : undefined,
          notes: item.notes as string | undefined,
          createdAt: item.created_at as string,
        })),
        createdAt: grn.created_at,
        updatedAt: grn.updated_at,
      };

      return apiResponse.success(res, result);
    } catch (error) {
      log.error('Failed to fetch GRN', { error: { error, id } }, 'ProcurementGrnDetailApi');
      return apiResponse.databaseError(res, error, 'Failed to fetch GRN');
    }
  } else if (req.method === 'PATCH') {
    try {
      const body = req.body;

      // Check current status
      const [current] = await sql`
        SELECT status FROM goods_receipt_notes WHERE id = ${id}
      `;

      if (!current) {
        return apiResponse.notFound(res, 'Goods Receipt Note', id);
      }

      // Only allow updates on draft/receiving status
      if (!['draft', 'receiving'].includes(current.status)) {
        return apiResponse.badRequest(res, 'Cannot update GRN in current status');
      }

      // Update GRN
      const [updated] = await sql`
        UPDATE goods_receipt_notes
        SET
          delivery_note_number = COALESCE(${body.deliveryNoteNumber}, delivery_note_number),
          carrier = COALESCE(${body.carrier}, carrier),
          vehicle_number = COALESCE(${body.vehicleNumber}, vehicle_number),
          receiving_bay = COALESCE(${body.receivingBay}, receiving_bay),
          notes = COALESCE(${body.notes}, notes),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING
          id, grn_number, purchase_order_id, supplier_id,
          delivery_date, delivery_note_number, carrier, vehicle_number,
          warehouse_id, receiving_bay, status,
          inspection_required, inspected_by, inspected_at,
          inspection_status, inspection_notes,
          total_items, total_quantity_expected, total_quantity_received,
          total_quantity_rejected,
          has_discrepancy, discrepancy_notes, discrepancy_resolved,
          discrepancy_resolved_by, discrepancy_resolved_at,
          received_by, received_by_name, verified_by, verified_at,
          notes, created_at, updated_at
      `;

      logUpdate('goods_receipt_note', id, body);

      return apiResponse.success(res, updated, 'GRN updated successfully');
    } catch (error) {
      log.error('Failed to update GRN', { error: { error, id } }, 'ProcurementGrnDetailApi');
      return apiResponse.databaseError(res, error, 'Failed to update GRN');
    }
  } else if (req.method === 'DELETE') {
    try {
      // Check current status
      const [current] = await sql`
        SELECT status FROM goods_receipt_notes WHERE id = ${id}
      `;

      if (!current) {
        return apiResponse.notFound(res, 'Goods Receipt Note', id);
      }

      // Only allow deletion of draft GRNs
      if (current.status !== 'draft') {
        return apiResponse.badRequest(res, 'Only draft GRNs can be deleted');
      }

      // Delete items first
      await sql`
        DELETE FROM goods_receipt_items WHERE grn_id = ${id}
      `;

      // Delete GRN
      await sql`
        DELETE FROM goods_receipt_notes WHERE id = ${id}
      `;

      logDelete('goods_receipt_note', id);

      return apiResponse.noContent(res);
    } catch (error) {
      log.error('Failed to delete GRN', { error: { error, id } }, 'ProcurementGrnDetailApi');
      return apiResponse.databaseError(res, error, 'Failed to delete GRN');
    }
  } else {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'PATCH', 'DELETE']);
  }
}));

import type { NextApiRequest, NextApiResponse } from 'next';
import type { PurchaseRequisition } from '@/types/procurement/requisition.types';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql, logUpdate, logDelete } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Requisition ID is required');
  }

  if (req.method === 'GET') {
    try {
      // Get requisition with project info
      const [requisition] = await sql`
        SELECT
          pr.*,
          p.name as project_name
        FROM purchase_requisitions pr
        LEFT JOIN projects p ON pr.project_id = p.id
        WHERE pr.id = ${id}
      `;

      if (!requisition) {
        return apiResponse.notFound(res, 'Purchase Requisition', id);
      }

      // Get items with supplier names
      const items = await sql`
        SELECT
          pri.*,
          s.company_name as suggested_supplier_name
        FROM purchase_requisition_items pri
        LEFT JOIN suppliers s ON pri.suggested_supplier_id = s.id
        WHERE pri.requisition_id = ${id}
        ORDER BY pri.created_at
      `;

      const result: PurchaseRequisition = {
        id: requisition.id,
        requisitionNumber: requisition.requisition_number,
        projectId: requisition.project_id,
        department: requisition.department,
        requestedBy: requisition.requested_by,
        requestedByName: requisition.requested_by_name,
        requestedDate: requisition.requested_date,
        requiredDate: requisition.required_date,
        status: requisition.status,
        approvedBy: requisition.approved_by,
        approvedAt: requisition.approved_at,
        rejectionReason: requisition.rejection_reason,
        estimatedTotal: requisition.estimated_total ? Number(requisition.estimated_total) : undefined,
        currency: requisition.currency || 'ZAR',
        urgency: requisition.urgency,
        notes: requisition.notes,
        items: items.map((item: Record<string, unknown>) => ({
          id: item.id as string,
          requisitionId: item.requisition_id as string,
          stockItemId: item.stock_item_id as string | undefined,
          itemCode: item.item_code as string | undefined,
          itemDescription: item.item_description as string,
          quantity: Number(item.quantity),
          uom: item.uom as string,
          estimatedUnitPrice: item.estimated_unit_price ? Number(item.estimated_unit_price) : undefined,
          estimatedTotal: item.estimated_total ? Number(item.estimated_total) : undefined,
          suggestedSupplierId: item.suggested_supplier_id ? Number(item.suggested_supplier_id) : undefined,
          suggestedSupplierName: item.suggested_supplier_name as string | undefined,
          notes: item.notes as string | undefined,
          convertedToRfq: item.converted_to_rfq as boolean,
          convertedToPo: item.converted_to_po as boolean,
          rfqId: item.rfq_id as string | undefined,
          poId: item.po_id as string | undefined,
          createdAt: item.created_at as string,
        })),
        createdAt: requisition.created_at,
        updatedAt: requisition.updated_at,
      };

      return apiResponse.success(res, result);
    } catch (error) {
      return apiResponse.databaseError(res, error, 'Failed to fetch requisition');
    }
  } else if (req.method === 'PUT') {
    try {
      const body = req.body;

      // Check if requisition exists and is in draft status
      const [existing] = await sql`
        SELECT status FROM purchase_requisitions WHERE id = ${id}
      `;

      if (!existing) {
        return apiResponse.notFound(res, 'Purchase Requisition', id);
      }

      if (existing.status !== 'draft') {
        return apiResponse.badRequest(res, 'Only draft requisitions can be edited');
      }

      // Update requisition
      const [updated] = await sql`
        UPDATE purchase_requisitions
        SET
          required_date = COALESCE(${body.requiredDate || null}, required_date),
          urgency = COALESCE(${body.urgency || null}, urgency),
          notes = COALESCE(${body.notes || null}, notes),
          department = COALESCE(${body.department || null}, department)
        WHERE id = ${id}
        RETURNING *
      `;

      logUpdate('purchase_requisition', id, body);

      return apiResponse.success(res, updated, 'Requisition updated successfully');
    } catch (error) {
      return apiResponse.databaseError(res, error, 'Failed to update requisition');
    }
  } else if (req.method === 'DELETE') {
    try {
      // Check if requisition exists and is in draft status
      const [existing] = await sql`
        SELECT status FROM purchase_requisitions WHERE id = ${id}
      `;

      if (!existing) {
        return apiResponse.notFound(res, 'Purchase Requisition', id);
      }

      if (existing.status !== 'draft') {
        return apiResponse.badRequest(res, 'Only draft requisitions can be deleted');
      }

      // Delete (items will cascade)
      await sql`DELETE FROM purchase_requisitions WHERE id = ${id}`;

      logDelete('purchase_requisition', id);

      return apiResponse.success(res, { id }, 'Requisition deleted successfully');
    } catch (error) {
      return apiResponse.databaseError(res, error, 'Failed to delete requisition');
    }
  } else {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'PUT', 'DELETE']);
  }
});

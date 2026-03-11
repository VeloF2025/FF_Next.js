import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql, logCreate } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const sql = createLoggedSql(process.env.DATABASE_URL!);

/**
 * POST /api/procurement/requisitions/[id]/create-rfq
 * Creates an RFQ from a requisition, copying over the items
 */
export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const { id: requisitionId } = req.query;
  const { supplierIds, responseDeadline, createdBy } = req.body;

  if (!requisitionId || typeof requisitionId !== 'string') {
    return apiResponse.validationError(res, { requisitionId: 'Requisition ID is required' });
  }

  try {
    // Get requisition details
    const requisitions = await sql`
      SELECT * FROM purchase_requisitions WHERE id = ${requisitionId}
    `;

    if (requisitions.length === 0) {
      return apiResponse.notFound(res, 'Requisition', requisitionId);
    }

    const requisition = requisitions[0];

    // Check if RFQ already exists for this requisition
    const existingRfq = await sql`
      SELECT id, rfq_number FROM rfqs WHERE requisition_id = ${requisitionId}
    `;

    if (existingRfq.length > 0) {
      return apiResponse.error(
        res,
        'CONFLICT',
        `RFQ ${existingRfq[0].rfq_number} already exists for this requisition`
      );
    }

    // Get requisition items
    const reqItems = await sql`
      SELECT * FROM purchase_requisition_items WHERE requisition_id = ${requisitionId}
    `;

    // Generate RFQ number
    const rfqNumber = `RFQ-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
    const deadline = responseDeadline || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    // Calculate total budget from requisition items
    const totalBudget = reqItems.reduce((sum: number, item: any) => {
      return sum + (Number(item.estimated_unit_price || 0) * Number(item.quantity || 0));
    }, 0);

    // Create the RFQ linked to requisition
    const insertedRfqs = await sql`
      INSERT INTO rfqs (
        rfq_number, project_id, requisition_id, title, description, status,
        response_deadline, total_budget_estimate, created_by
      )
      VALUES (
        ${rfqNumber},
        ${requisition.project_id},
        ${requisitionId},
        ${`RFQ for ${requisition.requisition_number}`},
        ${requisition.notes || `Request for quotes based on requisition ${requisition.requisition_number}`},
        'draft',
        ${deadline},
        ${totalBudget},
        ${createdBy || requisition.requested_by || 'System'}
      )
      RETURNING *
    `;

    const rfq = insertedRfqs[0];
    const rfqId = rfq.id;

    // Copy requisition items to RFQ items
    for (let i = 0; i < reqItems.length; i++) {
      const item = reqItems[i];
      await sql`
        INSERT INTO rfq_items (
          rfq_id, project_id, line_number, description, quantity, uom,
          specifications, budget_price, stock_item_id
        ) VALUES (
          ${rfqId},
          ${requisition.project_id},
          ${i + 1},
          ${item.description},
          ${item.quantity},
          ${item.uom || 'EA'},
          ${item.specifications || null},
          ${item.estimated_unit_price || 0},
          ${item.stock_item_id || null}
        )
      `;
    }

    // Add suppliers if provided
    const addedSuppliers: any[] = [];
    if (supplierIds && Array.isArray(supplierIds)) {
      for (const supplierId of supplierIds) {
        try {
          const result = await sql`
            INSERT INTO rfq_suppliers (rfq_id, supplier_id, status)
            VALUES (${rfqId}, ${parseInt(supplierId)}, 'invited')
            ON CONFLICT (rfq_id, supplier_id) DO NOTHING
            RETURNING *
          `;
          if (result[0]) {
            addedSuppliers.push(result[0]);
          }
        } catch (e) {
          log.error('CreateRfqApi', 'Operation failed', { error });
          // Skip invalid supplier IDs
        }
      }
    }

    // Update requisition status to show RFQ was created
    await sql`
      UPDATE purchase_requisitions
      SET status = 'rfq_created', updated_at = NOW()
      WHERE id = ${requisitionId}
    `;

    // Log creation
    logCreate('rfq', rfqId, {
      rfq_number: rfq.rfq_number,
      requisition_id: requisitionId,
      requisition_number: requisition.requisition_number,
      items_count: reqItems.length,
      suppliers_count: addedSuppliers.length
    });

    return apiResponse.created(res, {
      id: rfqId,
      rfqNumber: rfq.rfq_number,
      projectId: rfq.project_id,
      requisitionId: requisitionId,
      requisitionNumber: requisition.requisition_number,
      title: rfq.title,
      status: rfq.status,
      itemsCount: reqItems.length,
      suppliersCount: addedSuppliers.length,
      totalBudget: totalBudget
    }, 'RFQ created from requisition successfully');

  } catch (error: any) {
    log.error('CreateRfqApi', 'Failed to create RFQ from requisition', { error });
    return apiResponse.databaseError(res, error, 'Failed to create RFQ from requisition');
  }
}));

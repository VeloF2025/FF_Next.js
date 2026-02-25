import type { NextApiRequest, NextApiResponse } from 'next';
import type {
  PurchaseRequisition,
  PurchaseRequisitionItem,
  RequisitionListItem,
} from '@/types/procurement/requisition.types';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql, logCreate } from '@/lib/db-logger';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  // Get user info from authenticated request (withAuth attaches user to req)
  const authUser = (req as AuthenticatedNextApiRequest).user;
  const userId = authUser?.id || 'system';
  const userName = authUser?.name || authUser?.email || 'System User';

  if (req.method === 'GET') {
    try {
      const { page = '1', limit = '50' } = req.query;
      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const offsetNum = (pageNum - 1) * limitNum;

      // Get requisitions with item count
      const requisitions = await sql`
        SELECT
          pr.*,
          p.project_name as project_name,
          (SELECT COUNT(*) FROM purchase_requisition_items WHERE requisition_id = pr.id)::int as item_count
        FROM purchase_requisitions pr
        LEFT JOIN projects p ON pr.project_id = p.id
        ORDER BY pr.created_at DESC
        LIMIT ${limitNum} OFFSET ${offsetNum}
      `;

      // Get total count
      const countResult = await sql`
        SELECT COUNT(*)::int as total
        FROM purchase_requisitions pr
      `;

      // Transform to list items
      const items: RequisitionListItem[] = requisitions.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        requisitionNumber: r.requisition_number as string,
        projectId: r.project_id as string | undefined,
        projectName: r.project_name as string | undefined,
        department: r.department as string | undefined,
        requestedByName: r.requested_by_name as string | undefined,
        requestedDate: r.requested_date as string,
        requiredDate: r.required_date as string | undefined,
        status: r.status as PurchaseRequisition['status'],
        urgency: r.urgency as PurchaseRequisition['urgency'],
        estimatedTotal: r.estimated_total ? Number(r.estimated_total) : undefined,
        currency: (r.currency as string) || 'ZAR',
        itemCount: r.item_count as number,
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
      return apiResponse.databaseError(res, error, 'Failed to fetch requisitions');
    }
  } else if (req.method === 'POST') {
    try {
      const body = req.body;

      // Validate required fields
      if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
        return apiResponse.validationError(res, {
          items: 'At least one item is required',
        });
      }

      // Insert requisition
      const [requisition] = await sql`
        INSERT INTO purchase_requisitions (
          project_id,
          department,
          requested_by,
          requested_by_name,
          required_date,
          urgency,
          notes,
          status
        ) VALUES (
          ${body.projectId || null},
          ${body.department || null},
          ${userId},
          ${userName},
          ${body.requiredDate || null},
          ${body.urgency || 'normal'},
          ${body.notes || null},
          'draft'
        )
        RETURNING *
      `;

      // Insert items
      for (const item of body.items) {
        const estimatedTotal = item.estimatedUnitPrice && item.quantity
          ? item.estimatedUnitPrice * item.quantity
          : null;

        await sql`
          INSERT INTO purchase_requisition_items (
            requisition_id,
            stock_item_id,
            item_code,
            item_description,
            quantity,
            uom,
            estimated_unit_price,
            estimated_total,
            suggested_supplier_id,
            notes,
            boq_item_id,
            item_type
          ) VALUES (
            ${requisition!.id},
            ${item.stockItemId || null},
            ${item.itemCode || null},
            ${item.itemDescription},
            ${item.quantity},
            ${item.uom},
            ${item.estimatedUnitPrice || null},
            ${estimatedTotal},
            ${item.suggestedSupplierId || null},
            ${item.notes || null},
            ${item.boqItemId || null},
            ${item.itemType || 'adhoc'}
          )
        `;
      }

      // Log creation
      logCreate('purchase_requisition', requisition!.id, {
        requisition_number: requisition!.requisition_number,
        project_id: requisition!.project_id,
        items_count: body.items.length,
      });

      // Fetch the complete requisition with items
      const [fullRequisition] = await sql`
        SELECT * FROM purchase_requisitions WHERE id = ${requisition!.id}
      `;

      const items = await sql`
        SELECT * FROM purchase_requisition_items WHERE requisition_id = ${requisition!.id}
      `;

      const result: PurchaseRequisition = {
        id: fullRequisition!.id,
        requisitionNumber: fullRequisition!.requisition_number,
        projectId: fullRequisition!.project_id,
        department: fullRequisition!.department,
        requestedBy: fullRequisition!.requested_by,
        requestedByName: fullRequisition!.requested_by_name,
        requestedDate: fullRequisition!.requested_date,
        requiredDate: fullRequisition!.required_date,
        status: fullRequisition!.status,
        estimatedTotal: fullRequisition!.estimated_total ? Number(fullRequisition!.estimated_total) : undefined,
        currency: fullRequisition!.currency || 'ZAR',
        urgency: fullRequisition!.urgency,
        notes: fullRequisition!.notes,
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
          notes: item.notes as string | undefined,
          convertedToRfq: item.converted_to_rfq as boolean,
          convertedToPo: item.converted_to_po as boolean,
          rfqId: item.rfq_id as string | undefined,
          poId: item.po_id as string | undefined,
          boqItemId: item.boq_item_id as string | undefined,
          itemType: (item.item_type as 'boq' | 'adhoc') ?? 'adhoc',
          createdAt: item.created_at as string,
        })),
        createdAt: fullRequisition!.created_at,
        updatedAt: fullRequisition!.updated_at,
      };

      return apiResponse.created(res, result, 'Purchase requisition created successfully');
    } catch (error) {
      return apiResponse.databaseError(res, error, 'Failed to create requisition');
    }
  } else {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
  }
}));

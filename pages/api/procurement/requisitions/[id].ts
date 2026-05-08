import type { NextApiRequest, NextApiResponse } from 'next';
import type { PurchaseRequisition } from '@/types/procurement/requisition.types';
import { withErrorHandler } from '@/lib/api-error-handler';
import { neon } from '@neondatabase/serverless';
import { logUpdate, logDelete } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { userHasPermission } from '@/lib/permissions';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
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
          p.project_name as project_name,
          p.project_code as project_code
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

      // Get pending approval request ID (if any)
      const approvalRows = await sql`
        SELECT id FROM approval_requests
        WHERE document_type = 'purchase_requisition'
          AND document_id = ${id}
          AND status = 'pending'
        LIMIT 1
      `;
      const approvalRequestId = approvalRows.length > 0 ? approvalRows[0]!.id : null;

      const result: PurchaseRequisition = {
        id: requisition.id,
        requisitionNumber: requisition.requisition_number,
        projectId: requisition.project_id,
        projectName: requisition.project_name,
        projectCode: requisition.project_code,
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
        itemCount: items.length,
        approvalRequestId: approvalRequestId as string | null,
        createdAt: requisition.created_at,
        updatedAt: requisition.updated_at,
      };

      return apiResponse.success(res, result);
    } catch (error) {
      log.error('Failed to fetch requisition', { error: { error, id } }, 'ProcurementRequisitionDetailApi');
      return apiResponse.databaseError(res, error, 'Failed to fetch requisition');
    }
  } else if (req.method === 'PUT') {
    try {
      const body = req.body;
      const authReq = req as AuthenticatedNextApiRequest;
      const userId = authReq.user.id;

      const [existing] = await sql`
        SELECT requisition_number, status, requested_by, project_id, department, required_date
        FROM purchase_requisitions WHERE id = ${id}
      `;

      if (!existing) {
        return apiResponse.notFound(res, 'Purchase Requisition', id);
      }

      const status = existing.status;
      const isDraft = status === 'draft';
      const isSubmitted = status === 'submitted';
      const isPendingApproval = status === 'pending_approval';
      if (!isDraft && !isSubmitted && !isPendingApproval) {
        return apiResponse.badRequest(res, `Requisitions in status '${status}' cannot be edited`);
      }

      // Authorization: must be the requester, super_admin, or hold procurement.sourcing edit.
      const isRequester = String(existing.requested_by) === String(userId);
      const isSuperAdmin = authReq.user.role === 'super_admin';
      const hasProcurementEdit = isSuperAdmin
        ? true
        : await userHasPermission(userId, 'procurement.sourcing', 'edit');
      if (!isRequester && !hasProcurementEdit) {
        return apiResponse.forbidden(res, 'You are not authorised to edit this requisition');
      }

      // Detect actual changes (caller may send the full body unchanged).
      const wantsProjectChange =
        body.projectId !== undefined &&
        (body.projectId === '' ? null : body.projectId) !== existing.project_id;
      const wantsDeptChange =
        body.department !== undefined &&
        (body.department || null) !== (existing.department || null);
      const wantsRequiredDateChange =
        body.requiredDate !== undefined &&
        // Date columns may have time components; compare on the YYYY-MM-DD prefix.
        String(body.requiredDate || '').slice(0, 10) !==
          (existing.required_date ? String(existing.required_date).slice(0, 10) : '');
      const wantsUrgencyChange = body.urgency !== undefined;
      const wantsNotesChange = body.notes !== undefined;

      // Once an approval workflow has been spawned (pending_approval), the
      // selected approver is project-scoped; changing project would silently
      // route to the wrong chain. Lock project edits past 'submitted'.
      if (wantsProjectChange && !isDraft && !isSubmitted) {
        return apiResponse.badRequest(
          res,
          "Project cannot be changed once the requisition is in 'pending_approval'. Reject and resubmit if the project is wrong.",
        );
      }

      // Urgency / notes are draft-only edits. Permit submit/pending_approval
      // payloads to include them as long as they match existing values.
      if (!isDraft && wantsUrgencyChange) {
        return apiResponse.badRequest(res, 'Urgency can only be edited while the requisition is in draft');
      }
      if (!isDraft && wantsNotesChange) {
        return apiResponse.badRequest(res, 'Notes can only be edited while the requisition is in draft');
      }

      // Update requisition. Empty string clears a value (department, required_date).
      // For project_id: empty/null clears it; existing UUID retained when omitted.
      const [updated] = await sql`
        UPDATE purchase_requisitions
        SET
          project_id     = ${wantsProjectChange ? (body.projectId === '' ? null : body.projectId) : existing.project_id}::uuid,
          department     = ${wantsDeptChange ? (body.department || null) : (existing.department || null)},
          required_date  = ${wantsRequiredDateChange ? (body.requiredDate || null) : (existing.required_date || null)},
          urgency        = COALESCE(${isDraft && wantsUrgencyChange ? body.urgency : null}, urgency),
          notes          = COALESCE(${isDraft && wantsNotesChange ? body.notes : null}, notes),
          updated_at     = NOW()
        WHERE id = ${id}
        RETURNING *
      `;

      logUpdate('purchase_requisition', id, body);

      // Audit trail: write a row for any mid-flight (post-submit) edit so the
      // approval history can be reconstructed. Best-effort; failure must not
      // block the primary update.
      const editedFields: string[] = [];
      if (wantsProjectChange) editedFields.push('project_id');
      if (wantsDeptChange) editedFields.push('department');
      if (wantsRequiredDateChange) editedFields.push('required_date');
      if (!isDraft && editedFields.length > 0) {
        sql`
          INSERT INTO requisition_edit_history (
            requisition_id, edited_by, edited_at, status_at_edit,
            changed_fields, before_snapshot, after_snapshot
          ) VALUES (
            ${id}, ${userId}, NOW(), ${status},
            ${editedFields},
            ${JSON.stringify({
              project_id: existing.project_id,
              department: existing.department,
              required_date: existing.required_date,
            })}::jsonb,
            ${JSON.stringify({
              project_id: updated?.project_id,
              department: updated?.department,
              required_date: updated?.required_date,
            })}::jsonb
          )
        `.catch((err: unknown) =>
          log.warn(
            'Failed to write requisition_edit_history row',
            { error: err, requisitionId: id },
            'ProcurementRequisitionDetailApi',
          ),
        );
      }

      return apiResponse.success(res, updated, 'Requisition updated successfully');
    } catch (error) {
      log.error('Failed to update requisition', { error, id }, 'ProcurementRequisitionDetailApi');
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
      log.error('Failed to delete requisition', { error: { error, id } }, 'ProcurementRequisitionDetailApi');
      return apiResponse.databaseError(res, error, 'Failed to delete requisition');
    }
  } else {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'PUT', 'DELETE']);
  }
}));

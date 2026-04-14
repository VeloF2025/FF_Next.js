/**
 * PO Approval Status API
 *
 * GET /api/procurement/purchase-orders-approval?poId=xxx
 *   - Get approval status, level, and history for a PO
 *
 * GET /api/procurement/purchase-orders-approval?poId=xxx&checkPermission=true
 *   - Check if current user can approve
 *
 * GET /api/procurement/purchase-orders-approval?pending=true
 *   - Get all POs pending approval (for approvals dashboard)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, AuthenticatedRequest } from '@/lib/auth';
import { poApprovalService } from '@/services/procurement/approval';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const authReq = req as unknown as AuthenticatedRequest;
  const userId = authReq.user?.id;

  const { poId, checkPermission, pending } = req.query;

  try {
    // Get all pending POs for approvals dashboard
    if (pending === 'true') {
      return handleGetPendingPOs(res);
    }

    // Get approval status for specific PO
    if (poId && typeof poId === 'string') {
      // Check permission
      if (checkPermission === 'true' && userId) {
        const canApprove = await poApprovalService.canUserApprove(poId, userId);
        return apiResponse.success(res, { canApprove });
      }

      // Get full approval status
      const status = await poApprovalService.getApprovalStatus(poId);
      const quoteComparison = await poApprovalService.getQuoteComparisonForApproval(poId);

      return apiResponse.success(res, {
        ...status,
        quoteComparison,
      });
    }

    return apiResponse.badRequest(res, 'poId or pending parameter required');
  } catch (error) {
    log.error('Failed to get PO approval status', { error: error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGetPendingPOs(res: NextApiResponse) {
  try {
    // Get all POs in pending_approval status
    const result = await sql`
      SELECT
        po.id,
        po.po_number,
        po.status,
        po.total_amount,
        po.version,
        po.created_at,
        po.updated_at,
        COALESCE(s.company_name, s.name) as supplier_name,
        p.project_name,
        po.created_by,
        ar.id as approval_request_id,
        ar.requested_by_name,
        ar.due_date,
        ar.is_overdue,
        al.name as approval_level_name,
        al.min_amount,
        al.max_amount
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN projects p ON po.project_id = p.id
      LEFT JOIN approval_requests ar ON po.current_approval_request_id = ar.id
      LEFT JOIN approval_levels al ON ar.level_id = al.id
      WHERE po.status = 'pending_approval'
      ORDER BY ar.is_overdue DESC, ar.due_date ASC, po.created_at ASC
    `;

    const pendingPOs = result.map(po => ({
      id: po.id,
      poNumber: po.po_number,
      status: po.status,
      totalAmount: parseFloat(po.total_amount) || 0,
      version: po.version || 1,
      supplierName: po.supplier_name || 'Unknown Supplier',
      projectName: po.project_name,
      createdBy: po.created_by,
      createdAt: po.created_at,
      updatedAt: po.updated_at,
      approvalRequest: po.approval_request_id
        ? {
            id: po.approval_request_id,
            requestedByName: po.requested_by_name,
            dueDate: po.due_date,
            isOverdue: po.is_overdue,
            levelName: po.approval_level_name,
            thresholdMin: parseFloat(po.min_amount) || 0,
            thresholdMax: po.max_amount ? parseFloat(po.max_amount) : null,
          }
        : null,
    }));

    return apiResponse.success(res, {
      pendingCount: pendingPOs.length,
      pendingPOs,
    });
  } catch (error) {
    log.error('Failed to get pending POs', { error: error });
    throw error;
  }
}

export default withAuth(handler);

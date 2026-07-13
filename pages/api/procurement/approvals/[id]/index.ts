import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withErrorHandler } from '@/lib/api-error-handler';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { isEligibleApprover } from '@/modules/procurement/approvals/eligibility';

const sql = neon(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  const authReq = req as AuthenticatedNextApiRequest;
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return apiResponse.validationError(res, { id: 'Approval request ID is required' });
  }
  const rows = await sql`
    SELECT ar.id, ar.document_type, ar.document_id, ar.document_number,
           ar.document_amount, ar.status, ar.requested_by, ar.requested_by_name, ar.requested_at,
           ar.request_notes, ar.due_date, ar.is_overdue, ar.assigned_to,
           aw.name AS workflow_name, al.name AS level_name, al.level_number,
           al.approver_type, al.approver_user_id, al.approver_role,
           CASE WHEN al.approver_type = 'user'
                THEN COALESCE(u.first_name || ' ' || u.last_name, u.email)
                WHEN al.approver_type = 'role' AND al.approver_role IS NOT NULL
                THEN INITCAP(REPLACE(al.approver_role, '_', ' ')) END AS approver_name
    FROM approval_requests ar
    JOIN approval_workflows aw ON ar.workflow_id = aw.id
    JOIN approval_levels al ON ar.level_id = al.id
    LEFT JOIN users u ON al.approver_type = 'user' AND u.id::text = al.approver_user_id::text
    WHERE ar.id = ${id}
  `;
  if (rows.length === 0) return apiResponse.notFound(res, 'Approval request', id);
  const r = rows[0]!;
  const canAct = r.status === 'pending' && isEligibleApprover({
    userId: authReq.user.id, userRole: authReq.user.role,
    approverType: r.approver_type, approverUserId: r.approver_user_id,
    approverRole: r.approver_role, assignedTo: r.assigned_to ?? null,
  });
  return apiResponse.success(res, {
    id: r.id, documentType: r.document_type, documentId: r.document_id,
    documentNumber: r.document_number, documentAmount: r.document_amount == null ? null : Number(r.document_amount),
    status: r.status, requestedBy: r.requested_by, requestedByName: r.requested_by_name,
    requestedAt: r.requested_at, requestNotes: r.request_notes, dueDate: r.due_date,
    isOverdue: !!r.is_overdue, workflowName: r.workflow_name, levelName: r.level_name,
    levelNumber: r.level_number, approverType: r.approver_type, approverName: r.approver_name,
    canAct,
  });
}));

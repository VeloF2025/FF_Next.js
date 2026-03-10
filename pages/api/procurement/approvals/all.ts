/**
 * GET /api/procurement/approvals/all
 * Returns all approval requests (pending, approved, rejected, etc.) with summary counts.
 * Supports ?status=pending|approved|rejected|all (default: all)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const statusFilter = typeof req.query.status === 'string' ? req.query.status : 'all';

  try {
    // Get approval requests with workflow/level info
    let requests;
    if (statusFilter === 'all') {
      requests = await sql`
        SELECT
          ar.id, ar.document_type, ar.document_id, ar.document_number, ar.document_amount,
          ar.status, ar.requested_by, ar.requested_by_name, ar.requested_at, ar.request_notes,
          ar.assigned_to, ar.assigned_to_name, ar.responded_by, ar.responded_by_name,
          ar.responded_at, ar.response_notes, ar.due_date, ar.is_overdue,
          aw.name as workflow_name, al.name as level_name, al.level_number,
          al.approver_type, al.approver_user_id, al.approver_role
        FROM approval_requests ar
        JOIN approval_workflows aw ON ar.workflow_id = aw.id
        JOIN approval_levels al ON ar.level_id = al.id
        ORDER BY ar.requested_at DESC
        LIMIT 200
      `;
    } else if (statusFilter === 'pending') {
      requests = await sql`
        SELECT
          ar.id, ar.document_type, ar.document_id, ar.document_number, ar.document_amount,
          ar.status, ar.requested_by, ar.requested_by_name, ar.requested_at, ar.request_notes,
          ar.assigned_to, ar.assigned_to_name, ar.responded_by, ar.responded_by_name,
          ar.responded_at, ar.response_notes, ar.due_date, ar.is_overdue,
          aw.name as workflow_name, al.name as level_name, al.level_number,
          al.approver_type, al.approver_user_id, al.approver_role
        FROM approval_requests ar
        JOIN approval_workflows aw ON ar.workflow_id = aw.id
        JOIN approval_levels al ON ar.level_id = al.id
        WHERE ar.status = 'pending'
        ORDER BY ar.is_overdue DESC, ar.requested_at DESC
        LIMIT 200
      `;
    } else if (statusFilter === 'approved') {
      requests = await sql`
        SELECT
          ar.id, ar.document_type, ar.document_id, ar.document_number, ar.document_amount,
          ar.status, ar.requested_by, ar.requested_by_name, ar.requested_at, ar.request_notes,
          ar.assigned_to, ar.assigned_to_name, ar.responded_by, ar.responded_by_name,
          ar.responded_at, ar.response_notes, ar.due_date, ar.is_overdue,
          aw.name as workflow_name, al.name as level_name, al.level_number,
          al.approver_type, al.approver_user_id, al.approver_role
        FROM approval_requests ar
        JOIN approval_workflows aw ON ar.workflow_id = aw.id
        JOIN approval_levels al ON ar.level_id = al.id
        WHERE ar.status = 'approved'
        ORDER BY ar.responded_at DESC
        LIMIT 200
      `;
    } else {
      requests = await sql`
        SELECT
          ar.id, ar.document_type, ar.document_id, ar.document_number, ar.document_amount,
          ar.status, ar.requested_by, ar.requested_by_name, ar.requested_at, ar.request_notes,
          ar.assigned_to, ar.assigned_to_name, ar.responded_by, ar.responded_by_name,
          ar.responded_at, ar.response_notes, ar.due_date, ar.is_overdue,
          aw.name as workflow_name, al.name as level_name, al.level_number,
          al.approver_type, al.approver_user_id, al.approver_role
        FROM approval_requests ar
        JOIN approval_workflows aw ON ar.workflow_id = aw.id
        JOIN approval_levels al ON ar.level_id = al.id
        WHERE ar.status = ${statusFilter}
        ORDER BY ar.responded_at DESC NULLS LAST
        LIMIT 200
      `;
    }

    // Get status counts
    const statusCounts = await sql`
      SELECT status, COUNT(*)::int as count FROM approval_requests GROUP BY status
    `;

    const counts: Record<string, number> = {};
    let total = 0;
    for (const c of statusCounts) {
      counts[c.status as string] = c.count as number;
      total += c.count as number;
    }

    const approvals = requests.map((r: Record<string, unknown>) => ({
      id: r.id,
      documentType: r.document_type,
      documentId: r.document_id,
      documentNumber: r.document_number || null,
      documentAmount: r.document_amount ? Number(r.document_amount) : null,
      status: r.status,
      requestedBy: r.requested_by,
      requestedByName: r.requested_by_name || 'Unknown',
      requestedAt: r.requested_at,
      requestNotes: r.request_notes || null,
      assignedTo: r.assigned_to,
      assignedToName: r.assigned_to_name || null,
      respondedBy: r.responded_by,
      respondedByName: r.responded_by_name || null,
      respondedAt: r.responded_at || null,
      responseNotes: r.response_notes || null,
      dueDate: r.due_date || null,
      isOverdue: r.is_overdue || false,
      workflowName: r.workflow_name,
      levelName: r.level_name,
      levelNumber: r.level_number,
      approverType: r.approver_type,
      approverRole: r.approver_role || null,
    }));

    return apiResponse.success(res, {
      approvals,
      counts: { ...counts, total },
    });
  } catch (error) {
    return apiResponse.databaseError(res, error, 'Failed to fetch approvals');
  }
}));

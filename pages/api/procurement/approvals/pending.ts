import type { NextApiRequest, NextApiResponse } from 'next';
import type { MyApprovalTask, PendingApprovalsCount } from '@/types/procurement/approval.types';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { getAuth } from '@/lib/auth-mock';
import { withAuth } from '@/lib/auth';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { userId } = getAuth(req);

  try {
    // Get pending approval requests
    // In a real system, this would filter by assigned_to or by user's role
    const requests = await sql`
      SELECT
        ar.*,
        aw.name as workflow_name,
        al.name as level_name,
        al.level_number
      FROM approval_requests ar
      JOIN approval_workflows aw ON ar.workflow_id = aw.id
      JOIN approval_levels al ON ar.level_id = al.id
      WHERE ar.status = 'pending'
      ORDER BY ar.is_overdue DESC, ar.requested_at DESC
      LIMIT 50
    `;

    // Get counts by type
    const counts = await sql`
      SELECT
        ar.document_type,
        COUNT(*)::int as count,
        COUNT(CASE WHEN ar.is_overdue THEN 1 END)::int as overdue_count
      FROM approval_requests ar
      WHERE ar.status = 'pending'
      GROUP BY ar.document_type
    `;

    // Transform to approval tasks
    const tasks: MyApprovalTask[] = requests.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      documentType: r.document_type as MyApprovalTask['documentType'],
      documentId: r.document_id as string,
      documentNumber: r.document_number as string | undefined,
      documentAmount: r.document_amount ? Number(r.document_amount) : undefined,

      workflowName: r.workflow_name as string,
      levelName: r.level_name as string,
      levelNumber: r.level_number as number,

      requestedBy: r.requested_by as string,
      requestedByName: r.requested_by_name as string | undefined,
      requestedAt: r.requested_at as string,
      requestNotes: r.request_notes as string | undefined,

      dueDate: r.due_date as string | undefined,
      isOverdue: r.is_overdue as boolean,
      reminderCount: r.reminder_count as number,

      // Everyone can approve in this simplified version
      canApprove: true,
      canReject: true,
      canDelegate: false,
      canEscalate: false,
    }));

    // Build counts summary
    const countsByType: Record<string, number> = {};
    let total = 0;
    let overdue = 0;

    for (const c of counts) {
      countsByType[c.document_type as string] = c.count as number;
      total += c.count as number;
      overdue += c.overdue_count as number;
    }

    const summary: PendingApprovalsCount = {
      total,
      byType: countsByType as Record<MyApprovalTask['documentType'], number>,
      overdue,
    };

    return apiResponse.success(res, {
      tasks,
      summary,
    });
  } catch (error) {
    return apiResponse.databaseError(res, error, 'Failed to fetch pending approvals');
  }
}));

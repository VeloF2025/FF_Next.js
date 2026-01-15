import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql, logUpdate } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { getAuth } from '@/lib/auth-mock';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const { id } = req.query;
  const { userId } = getAuth(req);

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Requisition ID is required');
  }

  try {
    // Check current status
    const [requisition] = await sql`
      SELECT status, estimated_total FROM purchase_requisitions WHERE id = ${id}
    `;

    if (!requisition) {
      return apiResponse.notFound(res, 'Purchase Requisition', id);
    }

    if (requisition.status !== 'draft') {
      return apiResponse.badRequest(res, 'Only draft requisitions can be submitted');
    }

    // Check if requisition has items
    const [itemCount] = await sql`
      SELECT COUNT(*)::int as count FROM purchase_requisition_items WHERE requisition_id = ${id}
    `;

    if (itemCount.count === 0) {
      return apiResponse.badRequest(res, 'Cannot submit requisition without items');
    }

    // Determine if approval is required based on amount
    const amount = Number(requisition.estimated_total || 0);
    const needsApproval = amount >= 10000; // R10,000 threshold

    // Update status
    const newStatus = needsApproval ? 'pending_approval' : 'approved';

    const [updated] = await sql`
      UPDATE purchase_requisitions
      SET
        status = ${newStatus},
        approved_at = ${needsApproval ? null : new Date().toISOString()},
        approved_by = ${needsApproval ? null : 'auto-approved'}
      WHERE id = ${id}
      RETURNING *
    `;

    // Create approval request if needed
    if (needsApproval) {
      // Find applicable workflow
      const [workflow] = await sql`
        SELECT id FROM approval_workflows
        WHERE workflow_type = 'purchase_requisition'
        AND is_active = true
        LIMIT 1
      `;

      if (workflow) {
        // Find applicable level based on amount
        const [level] = await sql`
          SELECT id FROM approval_levels
          WHERE workflow_id = ${workflow.id}
          AND min_amount <= ${amount}
          AND (max_amount IS NULL OR max_amount >= ${amount})
          ORDER BY level_number
          LIMIT 1
        `;

        if (level) {
          await sql`
            INSERT INTO approval_requests (
              workflow_id,
              level_id,
              document_type,
              document_id,
              document_number,
              document_amount,
              requested_by,
              status
            ) VALUES (
              ${workflow.id},
              ${level.id},
              'purchase_requisition',
              ${id},
              ${updated.requisition_number},
              ${amount},
              ${userId || 'system'},
              'pending'
            )
          `;
        }
      }
    }

    logUpdate('purchase_requisition', id, { status: newStatus });

    return apiResponse.success(res, {
      id: updated.id,
      status: updated.status,
      message: needsApproval
        ? 'Requisition submitted for approval'
        : 'Requisition auto-approved (under threshold)',
    });
  } catch (error) {
    return apiResponse.databaseError(res, error, 'Failed to submit requisition');
  }
});

/**
 * POST /api/procurement/payment-requests
 * Creates a payment approval request and routes it through the approval workflow.
 * Falls back to auto-approve if no payment_request workflow is configured.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const authReq = req as AuthenticatedNextApiRequest;
  const userId = authReq.user.id;

  const {
    poId,
    rfqId,
    invoiceNumber,
    invoiceAmount,
    invoiceDate,
    dueDate,
    notes,
  } = req.body as {
    poId?: string;
    rfqId?: string;
    invoiceNumber?: string;
    invoiceAmount?: number | string;
    invoiceDate?: string;
    dueDate?: string;
    notes?: string;
  };

  // ---- Validation ----
  if (!invoiceNumber?.trim()) {
    return apiResponse.badRequest(res, 'Invoice number is required');
  }
  if (!invoiceAmount || Number(invoiceAmount) <= 0) {
    return apiResponse.badRequest(res, 'Valid invoice amount is required');
  }
  if (!dueDate) {
    return apiResponse.badRequest(res, 'Due date is required');
  }
  if (!poId && !rfqId) {
    return apiResponse.badRequest(res, 'Either PO or RFQ reference is required');
  }

  const amount = Number(invoiceAmount);
  const documentId = poId ?? rfqId!;
  const documentType = poId ? 'purchase_order' : 'rfq';

  try {
    // Find active payment_request workflow
    const workflows = await sql`
      SELECT id FROM approval_workflows
      WHERE workflow_type = 'payment_request'
      AND is_active = true
      LIMIT 1
    `;

    const workflow = workflows[0];

    if (!workflow) {
      // No workflow configured — auto-approve immediately
      log.info(
        'No payment_request workflow configured — auto-approving',
        { documentId, invoiceNumber, amount },
        'procurement'
      );
      return apiResponse.success(res, {
        id: crypto.randomUUID(),
        status: 'auto_approved',
        message: 'No payment workflow configured — auto-approved',
      });
    }

    // Find applicable approval level by amount band
    const levels = await sql`
      SELECT id FROM approval_levels
      WHERE workflow_id = ${workflow.id}
        AND min_amount <= ${amount}
        AND (max_amount IS NULL OR max_amount >= ${amount})
      ORDER BY level_number ASC
      LIMIT 1
    `;

    const level = levels[0];

    if (!level) {
      // Amount below minimum threshold — auto-approve
      log.info(
        'Payment amount below approval threshold — auto-approving',
        { documentId, amount },
        'procurement'
      );
      return apiResponse.success(res, {
        id: crypto.randomUUID(),
        status: 'auto_approved',
        message: 'Amount below minimum threshold — auto-approved',
      });
    }

    // Create the approval request record
    const inserted = await sql`
      INSERT INTO approval_requests (
        workflow_id,
        level_id,
        document_type,
        document_id,
        document_number,
        document_amount,
        requested_by,
        request_notes,
        due_date
      ) VALUES (
        ${workflow.id},
        ${level.id},
        ${documentType},
        ${documentId},
        ${invoiceNumber.trim()},
        ${amount},
        ${userId},
        ${notes?.trim() ?? null},
        ${dueDate}
      )
      RETURNING id, status
    `;

    const request = inserted[0];
    if (!request) {
      return apiResponse.databaseError(res, new Error('Insert returned no row'), 'Failed to create payment request');
    }

    log.info(
      'Payment approval request created',
      {
        approvalRequestId: request.id,
        documentType,
        documentId,
        invoiceNumber: invoiceNumber.trim(),
        amount,
        requestedBy: userId,
      },
      'procurement'
    );

    return apiResponse.success(res, {
      id: request.id as string,
      status: request.status as string,
    });
  } catch (error) {
    return apiResponse.databaseError(res, error, 'Failed to create payment request');
  }
}));

/**
 * Contractor Invoice Action API — Status Transitions
 *
 * POST /api/contractors/[contractorId]/invoices/[invoiceId]/action
 *      Body: { action: 'review' | 'approve' | 'pay' | 'reject', rejectionReason?, notes? }
 *
 * Valid transitions (server-enforced):
 *   submit  → submitted     (noop / re-trigger, kept for completeness)
 *   review  : submitted     → under_review
 *   approve : under_review  → approved
 *   pay     : approved      → paid
 *   reject  : approved      → rejected  (requires rejectionReason)
 *
 * Protected by auth middleware.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type {
  ContractorInvoiceStatus,
  ContractorInvoiceAction,
  ContractorInvoiceActionPayload,
  ContractorInvoiceWithDetails,
  InvoiceLineItem,
} from '@/types/contractor-invoice.types';

// ==================== Transition table ====================

interface TransitionDef {
  from: ContractorInvoiceStatus;
  to: ContractorInvoiceStatus;
  requiresReason: boolean;
}

const TRANSITIONS: Record<ContractorInvoiceAction, TransitionDef> = {
  submit:  { from: 'submitted',    to: 'submitted',    requiresReason: false },
  review:  { from: 'submitted',    to: 'under_review', requiresReason: false },
  approve: { from: 'under_review', to: 'approved',     requiresReason: false },
  pay:     { from: 'approved',     to: 'paid',         requiresReason: false },
  reject:  { from: 'approved',     to: 'rejected',     requiresReason: true  },
};

const VALID_ACTIONS = Object.keys(TRANSITIONS) as ContractorInvoiceAction[];

// ==================== Row type ====================

interface InvoiceRow {
  id: string;
  contractor_id: string;
  contractor_project_id: string | null;
  invoice_number: string;
  status: ContractorInvoiceStatus;
  line_items: InvoiceLineItem[] | string;
  total_amount: string;
  rejection_reason: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  project_name: string | null;
  project_code: string | null;
  role: string | null;
}

function mapRow(row: InvoiceRow): ContractorInvoiceWithDetails {
  const lineItems: InvoiceLineItem[] =
    typeof row.line_items === 'string'
      ? (JSON.parse(row.line_items) as InvoiceLineItem[])
      : row.line_items;

  return {
    id: row.id,
    contractorId: row.contractor_id,
    contractorProjectId: row.contractor_project_id
      ? Number(row.contractor_project_id)
      : null,
    invoiceNumber: row.invoice_number,
    status: row.status,
    lineItems,
    totalAmount: Number(row.total_amount),
    rejectionReason: row.rejection_reason,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    projectName: row.project_name,
    projectCode: row.project_code,
    role: row.role,
  };
}

// ==================== Handler ====================

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { contractorId, invoiceId } = req.query;

  if (!contractorId || typeof contractorId !== 'string') {
    return apiResponse.badRequest(res, 'Invalid contractor ID');
  }
  if (!invoiceId || typeof invoiceId !== 'string') {
    return apiResponse.badRequest(res, 'Invalid invoice ID');
  }

  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  try {
    const body = req.body as ContractorInvoiceActionPayload;

    if (!body.action || !VALID_ACTIONS.includes(body.action)) {
      return apiResponse.badRequest(
        res,
        `action must be one of: ${VALID_ACTIONS.join(', ')}`
      );
    }

    const transition = TRANSITIONS[body.action];

    if (transition.requiresReason && (!body.rejectionReason || !body.rejectionReason.trim())) {
      return apiResponse.badRequest(res, 'rejectionReason is required when rejecting an invoice');
    }

    // Load the invoice (verify it belongs to this contractor)
    const existing = (await sql`
      SELECT id, status FROM contractor_invoices
      WHERE id = ${invoiceId} AND contractor_id = ${contractorId}
    `) as unknown as Array<{ id: string; status: ContractorInvoiceStatus }>;

    if (!existing[0]) {
      return apiResponse.notFound(res, 'Invoice not found');
    }

    const currentStatus = existing[0].status;

    // 'submit' on already-submitted is a no-op
    if (body.action === 'submit' && currentStatus === 'submitted') {
      const rows = (await sql`
        SELECT
          ci.id, ci.contractor_id, ci.contractor_project_id,
          ci.invoice_number, ci.status, ci.line_items, ci.total_amount,
          ci.rejection_reason, ci.notes, ci.created_by, ci.created_at, ci.updated_at,
          p.project_name, p.project_code, cpj.role
        FROM contractor_invoices ci
        LEFT JOIN contractor_projects cpj ON ci.contractor_project_id = cpj.id
        LEFT JOIN projects p ON cpj.project_id = p.id
        WHERE ci.id = ${invoiceId}
      `) as unknown as InvoiceRow[];
      return res.status(200).json({ data: mapRow(rows[0]!) });
    }

    // Enforce valid transition
    if (currentStatus !== transition.from) {
      return apiResponse.badRequest(
        res,
        `Cannot '${body.action}': invoice is '${currentStatus}', expected '${transition.from}'`
      );
    }

    const rejectionReason = body.rejectionReason?.trim() ?? null;
    const notes = body.notes?.trim() ?? null;

    // Apply transition
    await sql`
      UPDATE contractor_invoices
      SET
        status           = ${transition.to},
        rejection_reason = ${rejectionReason},
        notes            = COALESCE(${notes}, notes)
      WHERE id = ${invoiceId}
    `;

    // Re-fetch with joins
    const updated = (await sql`
      SELECT
        ci.id, ci.contractor_id, ci.contractor_project_id,
        ci.invoice_number, ci.status, ci.line_items, ci.total_amount,
        ci.rejection_reason, ci.notes, ci.created_by, ci.created_at, ci.updated_at,
        p.project_name, p.project_code, cpj.role
      FROM contractor_invoices ci
      LEFT JOIN contractor_projects cpj ON ci.contractor_project_id = cpj.id
      LEFT JOIN projects p ON cpj.project_id = p.id
      WHERE ci.id = ${invoiceId}
    `) as unknown as InvoiceRow[];

    if (!updated[0]) {
      return apiResponse.internalError(res, new Error('Could not retrieve updated invoice'));
    }

    log.info('Invoice status transition applied', {
      invoiceId,
      contractorId,
      from: currentStatus,
      to: transition.to,
      action: body.action,
    });

    return res.status(200).json({ data: mapRow(updated[0]) });
  } catch (error) {
    log.error('Error applying invoice action', { error, contractorId, invoiceId });
    return apiResponse.internalError(res, new Error('Failed to apply invoice action'));
  }
}

export default withAuth(handler);

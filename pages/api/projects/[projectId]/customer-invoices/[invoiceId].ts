/**
 * Customer Invoice API - Get, Update, Actions
 * GET /api/projects/[projectId]/customer-invoices/[invoiceId] - Get invoice detail
 * PATCH /api/projects/[projectId]/customer-invoices/[invoiceId] - Update invoice
 * DELETE /api/projects/[projectId]/customer-invoices/[invoiceId] - Delete draft invoice
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type {
  CustomerInvoice,
  CustomerInvoiceItem,
  CustomerInvoiceUpdateInput,
  RecordPaymentInput,
} from '@/types/finance';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withRole, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { postCustomerInvoiceToGL, postCustomerPaymentToGL } from '@/modules/accounting/services/glIntegrationHooks';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withRole('super_admin')(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const userId = (req as AuthenticatedNextApiRequest).user.id;
  const projectId = req.query.projectId as string;
  const invoiceId = req.query.invoiceId as string;
  const action = req.query.action as string | undefined;

  if (!projectId || !invoiceId) {
    return apiResponse.badRequest(res, 'Project ID and Invoice ID are required');
  }

  // Handle actions via query param
  if (req.method === 'POST' && action) {
    return handleAction(req, res, invoiceId, projectId, action, userId);
  }

  // GET - Get invoice detail with items
  if (req.method === 'GET') {
    try {
      const result = await sql`
        SELECT
          ci.id, ci.invoice_number, ci.project_id, ci.client_id, ci.client_po_id,
          ci.billing_period_start, ci.billing_period_end,
          ci.subtotal, ci.tax_rate, ci.tax_amount, ci.total_amount, ci.amount_paid,
          ci.status, ci.invoice_date, ci.due_date, ci.sent_at, ci.paid_at,
          ci.notes, ci.internal_notes, ci.created_by,
          ci.approved_by, ci.approved_at, ci.created_at, ci.updated_at,
          c.company_name as client_name,
          p.project_name as project_name,
          cpo.po_number as client_po_number
        FROM customer_invoices ci
        LEFT JOIN clients c ON c.id = ci.client_id
        LEFT JOIN projects p ON p.id = ci.project_id
        LEFT JOIN client_purchase_orders cpo ON cpo.id = ci.client_po_id
        WHERE ci.id = ${invoiceId} AND ci.project_id = ${projectId}
      `;

      if (result.length === 0 || !result[0]) {
        return apiResponse.notFound(res, 'Customer Invoice', invoiceId);
      }

      const invoice = transformInvoice(result[0] as Record<string, unknown>);

      // Get line items
      const items = await sql`
        SELECT
          id, invoice_id, drop_id, oes_activation_id, drop_number,
          activation_date, description, unit_price, quantity,
          tax_amount, line_total, income_type, created_at
        FROM customer_invoice_items
        WHERE invoice_id = ${invoiceId}
        ORDER BY created_at ASC
      `;

      invoice.items = items.map((item) => transformItem(item as Record<string, unknown>));

      return apiResponse.success(res, { invoice });
    } catch (error) {
      log.error('Failed to fetch customer invoice', { projectId, invoiceId, error });
      return apiResponse.databaseError(res, error, 'Failed to fetch customer invoice');
    }
  }

  // PATCH - Update invoice (draft only)
  if (req.method === 'PATCH') {
    try {
      const body = req.body as CustomerInvoiceUpdateInput;

      // Get existing
      const existingPatch = await sql`
        SELECT id, status FROM customer_invoices
        WHERE id = ${invoiceId} AND project_id = ${projectId}
      `;

      if (existingPatch.length === 0 || !existingPatch[0]) {
        return apiResponse.notFound(res, 'Customer Invoice', invoiceId);
      }

      if (existingPatch[0].status !== 'draft') {
        return apiResponse.forbidden(res, 'Only draft invoices can be edited');
      }

      // Update
      const result = await sql`
        UPDATE customer_invoices
        SET
          tax_rate = COALESCE(${body.taxRate}, tax_rate),
          due_date = COALESCE(${body.dueDate}, due_date),
          notes = COALESCE(${body.notes}, notes),
          internal_notes = COALESCE(${body.internalNotes}, internal_notes),
          updated_at = NOW()
        WHERE id = ${invoiceId}
        RETURNING id
      `;

      // Recalculate totals if tax rate changed
      if (body.taxRate !== undefined) {
        await sql`SELECT calculate_invoice_totals(${invoiceId})`;
      }

      // Get refreshed
      const refreshed = await sql`
        SELECT
          ci.id, ci.invoice_number, ci.project_id, ci.client_id, ci.client_po_id,
          ci.billing_period_start, ci.billing_period_end,
          ci.subtotal, ci.tax_rate, ci.tax_amount, ci.total_amount, ci.amount_paid,
          ci.status, ci.invoice_date, ci.due_date, ci.sent_at, ci.paid_at,
          ci.notes, ci.internal_notes, ci.created_by,
          ci.approved_by, ci.approved_at, ci.created_at, ci.updated_at,
          c.company_name as client_name,
          p.project_name as project_name,
          cpo.po_number as client_po_number
        FROM customer_invoices ci
        LEFT JOIN clients c ON c.id = ci.client_id
        LEFT JOIN projects p ON p.id = ci.project_id
        LEFT JOIN client_purchase_orders cpo ON cpo.id = ci.client_po_id
        WHERE ci.id = ${invoiceId}
      `;

      log.info('Customer invoice updated', { invoiceId, projectId });

      const invoiceData = refreshed[0] || result[0];
      return apiResponse.success(res, {
        invoice: invoiceData ? transformInvoice(invoiceData as Record<string, unknown>) : null,
      });
    } catch (error) {
      log.error('Failed to update customer invoice', { projectId, invoiceId, error });
      return apiResponse.databaseError(res, error, 'Failed to update customer invoice');
    }
  }

  // DELETE - Delete draft invoice
  if (req.method === 'DELETE') {
    try {
      const existingDel = await sql`
        SELECT status FROM customer_invoices
        WHERE id = ${invoiceId} AND project_id = ${projectId}
      `;

      if (existingDel.length === 0 || !existingDel[0]) {
        return apiResponse.notFound(res, 'Customer Invoice', invoiceId);
      }

      if (existingDel[0].status !== 'draft') {
        return apiResponse.forbidden(res, 'Only draft invoices can be deleted');
      }

      // Delete items first (cascade should handle this, but be explicit)
      await sql`DELETE FROM customer_invoice_items WHERE invoice_id = ${invoiceId}`;
      await sql`DELETE FROM customer_invoices WHERE id = ${invoiceId}`;

      log.info('Customer invoice deleted', { invoiceId, projectId });

      return apiResponse.success(res, { deleted: true });
    } catch (error) {
      log.error('Failed to delete customer invoice', { projectId, invoiceId, error });
      return apiResponse.databaseError(res, error, 'Failed to delete customer invoice');
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PATCH', 'DELETE', 'POST']);
})));

async function handleAction(
  req: NextApiRequest,
  res: NextApiResponse,
  invoiceId: string,
  projectId: string,
  action: string,
  userId: string
) {
  const existingAction = await sql`
    SELECT id, status, amount_paid, total_amount
    FROM customer_invoices
    WHERE id = ${invoiceId} AND project_id = ${projectId}
  `;

  if (existingAction.length === 0 || !existingAction[0]) {
    return apiResponse.notFound(res, 'Customer Invoice', invoiceId);
  }

  const invoice = existingAction[0];

  switch (action) {
    case 'submit':
      // Submit for approval
      if (invoice.status !== 'draft') {
        return apiResponse.forbidden(res, 'Only draft invoices can be submitted');
      }
      await sql`
        UPDATE customer_invoices
        SET status = 'pending_approval', updated_at = NOW()
        WHERE id = ${invoiceId}
      `;
      log.info('Invoice submitted for approval', { invoiceId, projectId });
      return apiResponse.success(res, { status: 'pending_approval' });

    case 'approve':
      // Approve invoice
      if (invoice.status !== 'pending_approval' && invoice.status !== 'draft') {
        return apiResponse.forbidden(res, 'Invoice is not pending approval');
      }
      await sql`
        UPDATE customer_invoices
        SET status = 'approved', approved_by = ${userId}, approved_at = NOW(), updated_at = NOW()
        WHERE id = ${invoiceId}
      `;
      log.info('Invoice approved', { invoiceId, projectId, approvedBy: userId });
      // GL integration: DR AR, CR Revenue
      await postCustomerInvoiceToGL(invoiceId, projectId, userId);
      return apiResponse.success(res, { status: 'approved' });

    case 'send':
      // Mark as sent
      if (!['approved', 'draft'].includes(invoice.status)) {
        return apiResponse.forbidden(res, 'Invoice must be approved before sending');
      }
      await sql`
        UPDATE customer_invoices
        SET status = 'sent', sent_at = NOW(), updated_at = NOW()
        WHERE id = ${invoiceId}
      `;
      log.info('Invoice marked as sent', { invoiceId, projectId });
      return apiResponse.success(res, { status: 'sent' });

    case 'record-payment':
      // Record payment
      const body = req.body as RecordPaymentInput;
      if (!body.amount || body.amount <= 0) {
        return apiResponse.validationError(res, { amount: 'Payment amount is required' });
      }

      const newAmountPaid = Number(invoice.amount_paid) + body.amount;
      const totalAmount = Number(invoice.total_amount);

      let newStatus = invoice.status;
      if (newAmountPaid >= totalAmount) {
        newStatus = 'paid';
      } else if (newAmountPaid > 0) {
        newStatus = 'partially_paid';
      }

      await sql`
        UPDATE customer_invoices
        SET
          amount_paid = ${newAmountPaid},
          status = ${newStatus},
          paid_at = CASE WHEN ${newAmountPaid} >= total_amount THEN NOW() ELSE paid_at END,
          updated_at = NOW()
        WHERE id = ${invoiceId}
      `;

      log.info('Payment recorded', { invoiceId, projectId, amount: body.amount, newStatus });
      // GL integration: DR Bank, CR AR
      await postCustomerPaymentToGL(invoiceId, body.amount, projectId, userId);
      return apiResponse.success(res, { amountPaid: newAmountPaid, status: newStatus });

    case 'cancel':
      // Cancel invoice
      if (invoice.status === 'paid') {
        return apiResponse.forbidden(res, 'Cannot cancel paid invoice');
      }
      await sql`
        UPDATE customer_invoices
        SET status = 'cancelled', updated_at = NOW()
        WHERE id = ${invoiceId}
      `;

      // Unmark drops as invoiced
      await sql`
        UPDATE drops
        SET invoiced = false, invoice_id = NULL
        WHERE invoice_id = ${invoiceId}
      `;

      log.info('Invoice cancelled', { invoiceId, projectId });
      return apiResponse.success(res, { status: 'cancelled' });

    default:
      return apiResponse.badRequest(res, `Unknown action: ${action}`);
  }
}

function transformInvoice(row: Record<string, unknown>): CustomerInvoice {
  return {
    id: row.id as string,
    invoiceNumber: row.invoice_number as string,
    projectId: row.project_id as string,
    clientId: row.client_id as string,
    clientPoId: row.client_po_id as string | undefined,
    billingPeriodStart: row.billing_period_start as string,
    billingPeriodEnd: row.billing_period_end as string,
    subtotal: Number(row.subtotal || 0),
    taxRate: Number(row.tax_rate),
    taxAmount: Number(row.tax_amount || 0),
    totalAmount: Number(row.total_amount || 0),
    amountPaid: Number(row.amount_paid || 0),
    status: row.status as CustomerInvoice['status'],
    invoiceDate: row.invoice_date as string,
    dueDate: row.due_date as string | undefined,
    sentAt: row.sent_at as string | undefined,
    paidAt: row.paid_at as string | undefined,
    notes: row.notes as string | undefined,
    internalNotes: row.internal_notes as string | undefined,
    createdBy: row.created_by as string,
    approvedBy: row.approved_by as string | undefined,
    approvedAt: row.approved_at as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    clientName: row.client_name as string | undefined,
    projectName: row.project_name as string | undefined,
    clientPoNumber: row.client_po_number as string | undefined,
  };
}

function transformItem(row: Record<string, unknown>): CustomerInvoiceItem {
  return {
    id: row.id as string,
    invoiceId: row.invoice_id as string,
    dropId: row.drop_id as string | undefined,
    oesActivationId: row.oes_activation_id as string | undefined,
    dropNumber: row.drop_number as string,
    activationDate: row.activation_date as string | undefined,
    description: row.description as string | undefined,
    unitPrice: Number(row.unit_price),
    quantity: Number(row.quantity || 1),
    taxAmount: Number(row.tax_amount || 0),
    lineTotal: Number(row.line_total || 0),
    incomeType: row.income_type as CustomerInvoiceItem['incomeType'],
    createdAt: row.created_at as string,
  };
}

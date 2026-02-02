/**
 * Customer Invoice API - List and Create
 * GET /api/projects/[projectId]/customer-invoices - List invoices
 * POST /api/projects/[projectId]/customer-invoices - Create invoice manually
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { CustomerInvoice, CustomerInvoiceCreateInput } from '@/types/finance';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const userId = (req as AuthenticatedNextApiRequest).user.id;
  const projectId = req.query.projectId as string;

  if (!projectId) {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  // GET - List customer invoices
  if (req.method === 'GET') {
    try {
      const status = req.query.status as string | undefined;
      const clientPoId = req.query.clientPoId as string | undefined;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = (page - 1) * limit;

      const invoices = await sql`
        SELECT
          ci.*,
          c.company_name as client_name,
          p.name as project_name,
          cpo.po_number as client_po_number
        FROM customer_invoices ci
        LEFT JOIN clients c ON c.id = ci.client_id
        LEFT JOIN projects p ON p.id = ci.project_id
        LEFT JOIN client_purchase_orders cpo ON cpo.id = ci.client_po_id
        WHERE ci.project_id = ${projectId}
        ${status ? sql`AND ci.status = ${status}` : sql``}
        ${clientPoId ? sql`AND ci.client_po_id = ${clientPoId}` : sql``}
        ORDER BY ci.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const countResult = await sql`
        SELECT COUNT(*) as total
        FROM customer_invoices ci
        WHERE ci.project_id = ${projectId}
        ${status ? sql`AND ci.status = ${status}` : sql``}
        ${clientPoId ? sql`AND ci.client_po_id = ${clientPoId}` : sql``}
      `;

      const total = Number(countResult[0]?.total || 0);

      // Get summary stats
      const summary = await sql`
        SELECT
          COALESCE(SUM(total_amount), 0) as total_invoiced,
          COALESCE(SUM(amount_paid), 0) as total_paid,
          COUNT(*) as invoice_count,
          COUNT(*) FILTER (WHERE status = 'draft') as draft_count,
          COUNT(*) FILTER (WHERE status = 'pending_approval') as pending_approval_count,
          COUNT(*) FILTER (WHERE status = 'sent') as sent_count,
          COUNT(*) FILTER (WHERE status = 'overdue') as overdue_count
        FROM customer_invoices
        WHERE project_id = ${projectId}
      `;

      return apiResponse.success(res, {
        invoices: invoices.map(transformInvoice),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        summary: {
          totalInvoiced: Number(summary[0]?.total_invoiced || 0),
          totalPaid: Number(summary[0]?.total_paid || 0),
          totalOutstanding: Number(summary[0]?.total_invoiced || 0) - Number(summary[0]?.total_paid || 0),
          invoiceCount: Number(summary[0]?.invoice_count || 0),
          draftCount: Number(summary[0]?.draft_count || 0),
          pendingApprovalCount: Number(summary[0]?.pending_approval_count || 0),
          sentCount: Number(summary[0]?.sent_count || 0),
          overdueCount: Number(summary[0]?.overdue_count || 0),
        },
      });
    } catch (error) {
      log.error('Failed to fetch customer invoices', { projectId, error });
      return apiResponse.databaseError(res, error, 'Failed to fetch customer invoices');
    }
  }

  // POST - Create invoice manually
  if (req.method === 'POST') {
    try {
      const body = req.body as CustomerInvoiceCreateInput;

      // Validation
      if (!body.billingPeriodStart || !body.billingPeriodEnd) {
        return apiResponse.validationError(res, {
          billingPeriod: 'Billing period start and end dates are required',
        });
      }

      // Get project's client
      const projectResult = await sql`
        SELECT client_id FROM projects WHERE id = ${projectId}
      `;
      if (!projectResult[0]?.client_id) {
        return apiResponse.validationError(res, {
          clientId: 'Project has no client assigned',
        });
      }
      const clientId = projectResult[0].client_id;

      // Get tax rate from Client PO if specified, otherwise default
      let taxRate = body.taxRate ?? 15;
      if (body.clientPoId) {
        const poResult = await sql`
          SELECT tax_rate FROM client_purchase_orders
          WHERE id = ${body.clientPoId} AND project_id = ${projectId}
        `;
        const poData = poResult[0];
        if (!poData) {
          return apiResponse.notFound(res, 'Client PO', body.clientPoId);
        }
        taxRate = Number(poData.tax_rate);
      }

      // Generate invoice number
      const invoiceNumber = await sql`SELECT generate_customer_invoice_number() as num`;
      const invNum = invoiceNumber[0]?.num;

      // Create invoice
      const result = await sql`
        INSERT INTO customer_invoices (
          invoice_number, project_id, client_id, client_po_id,
          billing_period_start, billing_period_end,
          tax_rate, due_date,
          notes, internal_notes,
          status, created_by
        ) VALUES (
          ${invNum},
          ${projectId},
          ${clientId},
          ${body.clientPoId || null},
          ${body.billingPeriodStart},
          ${body.billingPeriodEnd},
          ${taxRate},
          ${body.dueDate || null},
          ${body.notes || null},
          ${body.internalNotes || null},
          'draft',
          ${userId || 'system'}
        )
        RETURNING *
      `;

      const newInvoice = result[0];
      if (!newInvoice) {
        return apiResponse.internalError(res, new Error('Failed to create invoice'));
      }

      // Add items if provided
      if (body.items && body.items.length > 0) {
        for (const item of body.items) {
          const lineTotal = item.unitPrice * (item.quantity || 1);
          const itemTax = Math.round(lineTotal * taxRate / 100 * 100) / 100;

          await sql`
            INSERT INTO customer_invoice_items (
              invoice_id, drop_id, oes_activation_id,
              drop_number, activation_date, description,
              unit_price, quantity, tax_amount, line_total,
              income_type
            ) VALUES (
              ${newInvoice.id},
              ${item.dropId || null},
              ${item.oesActivationId || null},
              ${item.dropNumber},
              ${item.activationDate || null},
              ${item.description || null},
              ${item.unitPrice},
              ${item.quantity || 1},
              ${itemTax},
              ${lineTotal},
              ${item.incomeType || 'activation'}
            )
          `;
        }

        // Calculate totals
        await sql`SELECT calculate_invoice_totals(${newInvoice.id})`;
      }

      // Get with joined data
      const created = await sql`
        SELECT
          ci.*,
          c.company_name as client_name,
          p.name as project_name,
          cpo.po_number as client_po_number
        FROM customer_invoices ci
        LEFT JOIN clients c ON c.id = ci.client_id
        LEFT JOIN projects p ON p.id = ci.project_id
        LEFT JOIN client_purchase_orders cpo ON cpo.id = ci.client_po_id
        WHERE ci.id = ${newInvoice.id}
      `;

      log.info('Customer invoice created', {
        invoiceId: newInvoice.id,
        invoiceNumber: invNum,
        projectId,
      });

      return apiResponse.created(res, {
        invoice: transformInvoice(created[0] || newInvoice),
      });
    } catch (error) {
      log.error('Failed to create customer invoice', { projectId, error });
      return apiResponse.databaseError(res, error, 'Failed to create customer invoice');
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}));

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

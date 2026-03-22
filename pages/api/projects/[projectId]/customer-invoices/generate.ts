/**
 * Generate Customer Invoice from Activated Drops
 * GET /api/projects/[projectId]/customer-invoices/generate - Preview (get uninvoiced drops)
 * POST /api/projects/[projectId]/customer-invoices/generate - Generate invoice
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type {
  GenerateInvoiceInput,
  GenerateInvoicePreview,
  UninvoicedDrop,
  CustomerInvoice,
} from '@/types/finance';
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

  // GET - Preview: Get uninvoiced activated drops
  if (req.method === 'GET') {
    try {
      const clientPoId = req.query.clientPoId as string | undefined;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      // Get uninvoiced activated drops — explicit branches to avoid conditional SQL fragments (Neon rule)
      let drops;
      if (clientPoId && startDate && endDate) {
        drops = await sql`
          SELECT d.id as drop_id, d.drop_number, d.lid, d.client_po_id,
                 cpo.po_number as client_po_number, oa.activation_date::DATE as activation_date,
                 COALESCE(cpo.price_per_drop, 0) as price_per_drop
          FROM drops d INNER JOIN oes_activations oa ON oa.drop_id = d.id
          LEFT JOIN client_purchase_orders cpo ON cpo.id = d.client_po_id
          WHERE d.project_id = ${projectId} AND d.invoiced = false
            AND d.client_po_id = ${clientPoId}
            AND oa.activation_date >= ${startDate} AND oa.activation_date <= ${endDate}
          ORDER BY oa.activation_date DESC, d.drop_number
        `;
      } else if (clientPoId && startDate) {
        drops = await sql`
          SELECT d.id as drop_id, d.drop_number, d.lid, d.client_po_id,
                 cpo.po_number as client_po_number, oa.activation_date::DATE as activation_date,
                 COALESCE(cpo.price_per_drop, 0) as price_per_drop
          FROM drops d INNER JOIN oes_activations oa ON oa.drop_id = d.id
          LEFT JOIN client_purchase_orders cpo ON cpo.id = d.client_po_id
          WHERE d.project_id = ${projectId} AND d.invoiced = false
            AND d.client_po_id = ${clientPoId} AND oa.activation_date >= ${startDate}
          ORDER BY oa.activation_date DESC, d.drop_number
        `;
      } else if (clientPoId && endDate) {
        drops = await sql`
          SELECT d.id as drop_id, d.drop_number, d.lid, d.client_po_id,
                 cpo.po_number as client_po_number, oa.activation_date::DATE as activation_date,
                 COALESCE(cpo.price_per_drop, 0) as price_per_drop
          FROM drops d INNER JOIN oes_activations oa ON oa.drop_id = d.id
          LEFT JOIN client_purchase_orders cpo ON cpo.id = d.client_po_id
          WHERE d.project_id = ${projectId} AND d.invoiced = false
            AND d.client_po_id = ${clientPoId} AND oa.activation_date <= ${endDate}
          ORDER BY oa.activation_date DESC, d.drop_number
        `;
      } else if (clientPoId) {
        drops = await sql`
          SELECT d.id as drop_id, d.drop_number, d.lid, d.client_po_id,
                 cpo.po_number as client_po_number, oa.activation_date::DATE as activation_date,
                 COALESCE(cpo.price_per_drop, 0) as price_per_drop
          FROM drops d INNER JOIN oes_activations oa ON oa.drop_id = d.id
          LEFT JOIN client_purchase_orders cpo ON cpo.id = d.client_po_id
          WHERE d.project_id = ${projectId} AND d.invoiced = false
            AND d.client_po_id = ${clientPoId}
          ORDER BY oa.activation_date DESC, d.drop_number
        `;
      } else if (startDate && endDate) {
        drops = await sql`
          SELECT d.id as drop_id, d.drop_number, d.lid, d.client_po_id,
                 cpo.po_number as client_po_number, oa.activation_date::DATE as activation_date,
                 COALESCE(cpo.price_per_drop, 0) as price_per_drop
          FROM drops d INNER JOIN oes_activations oa ON oa.drop_id = d.id
          LEFT JOIN client_purchase_orders cpo ON cpo.id = d.client_po_id
          WHERE d.project_id = ${projectId} AND d.invoiced = false
            AND oa.activation_date >= ${startDate} AND oa.activation_date <= ${endDate}
          ORDER BY oa.activation_date DESC, d.drop_number
        `;
      } else if (startDate) {
        drops = await sql`
          SELECT d.id as drop_id, d.drop_number, d.lid, d.client_po_id,
                 cpo.po_number as client_po_number, oa.activation_date::DATE as activation_date,
                 COALESCE(cpo.price_per_drop, 0) as price_per_drop
          FROM drops d INNER JOIN oes_activations oa ON oa.drop_id = d.id
          LEFT JOIN client_purchase_orders cpo ON cpo.id = d.client_po_id
          WHERE d.project_id = ${projectId} AND d.invoiced = false
            AND oa.activation_date >= ${startDate}
          ORDER BY oa.activation_date DESC, d.drop_number
        `;
      } else if (endDate) {
        drops = await sql`
          SELECT d.id as drop_id, d.drop_number, d.lid, d.client_po_id,
                 cpo.po_number as client_po_number, oa.activation_date::DATE as activation_date,
                 COALESCE(cpo.price_per_drop, 0) as price_per_drop
          FROM drops d INNER JOIN oes_activations oa ON oa.drop_id = d.id
          LEFT JOIN client_purchase_orders cpo ON cpo.id = d.client_po_id
          WHERE d.project_id = ${projectId} AND d.invoiced = false
            AND oa.activation_date <= ${endDate}
          ORDER BY oa.activation_date DESC, d.drop_number
        `;
      } else {
        drops = await sql`
          SELECT d.id as drop_id, d.drop_number, d.lid, d.client_po_id,
                 cpo.po_number as client_po_number, oa.activation_date::DATE as activation_date,
                 COALESCE(cpo.price_per_drop, 0) as price_per_drop
          FROM drops d INNER JOIN oes_activations oa ON oa.drop_id = d.id
          LEFT JOIN client_purchase_orders cpo ON cpo.id = d.client_po_id
          WHERE d.project_id = ${projectId} AND d.invoiced = false
          ORDER BY oa.activation_date DESC, d.drop_number
        `;
      }

      // Get Client PO details for tax rate
      let taxRate = 15;
      let pricePerDrop = 0;
      let clientPoNumber: string | undefined;

      if (clientPoId) {
        const poResult = await sql`
          SELECT tax_rate, price_per_drop, po_number
          FROM client_purchase_orders
          WHERE id = ${clientPoId}
        `;
        const poData = poResult[0];
        if (poData) {
          taxRate = Number(poData.tax_rate);
          pricePerDrop = Number(poData.price_per_drop);
          clientPoNumber = poData.po_number as string;
        }
      } else if (drops.length > 0) {
        const firstDrop = drops[0];
        if (firstDrop?.price_per_drop) {
          pricePerDrop = Number(firstDrop.price_per_drop);
        }
      }

      // Calculate totals
      const subtotal = drops.reduce((sum, d) => {
        const price = Number(d.price_per_drop) || pricePerDrop;
        return sum + price;
      }, 0);
      const taxAmount = Math.round(subtotal * taxRate / 100 * 100) / 100;
      const totalAmount = subtotal + taxAmount;

      const preview: GenerateInvoicePreview = {
        clientPoId,
        clientPoNumber,
        pricePerDrop,
        taxRate,
        drops: drops.map(d => ({
          dropId: d.drop_id,
          dropNumber: d.drop_number,
          lid: d.lid,
          clientPoId: d.client_po_id,
          clientPoNumber: d.client_po_number,
          activationDate: d.activation_date,
          pricePerDrop: Number(d.price_per_drop) || pricePerDrop,
        })),
        subtotal,
        taxAmount,
        totalAmount,
      };

      return apiResponse.success(res, { preview });
    } catch (error) {
      log.error('Failed to preview invoice generation', { projectId, error });
      return apiResponse.databaseError(res, error, 'Failed to preview invoice generation');
    }
  }

  // POST - Generate invoice from activated drops
  if (req.method === 'POST') {
    try {
      const body = req.body as GenerateInvoiceInput;

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
        return apiResponse.validationError(res, { clientId: 'Project has no client assigned' });
      }
      const clientId = projectResult[0].client_id;

      // Get tax rate and price from Client PO
      let taxRate = 15;
      let defaultPrice = 0;
      if (body.clientPoId) {
        const poResult = await sql`
          SELECT tax_rate, price_per_drop
          FROM client_purchase_orders
          WHERE id = ${body.clientPoId} AND project_id = ${projectId}
        `;
        const poData = poResult[0];
        if (!poData) {
          return apiResponse.notFound(res, 'Client PO', body.clientPoId);
        }
        taxRate = Number(poData.tax_rate);
        defaultPrice = Number(poData.price_per_drop);
      }

      // Get uninvoiced activated drops for the period — explicit branches (Neon rule)
      const dropsForPeriod = body.clientPoId
        ? await sql`
            SELECT d.id as drop_id, d.drop_number, d.lid, d.client_po_id,
                   oa.id as oes_activation_id, oa.activation_date::DATE as activation_date,
                   COALESCE(cpo.price_per_drop, ${defaultPrice}) as price_per_drop
            FROM drops d
            INNER JOIN oes_activations oa ON oa.drop_id = d.id
            LEFT JOIN client_purchase_orders cpo ON cpo.id = d.client_po_id
            WHERE d.project_id = ${projectId} AND d.invoiced = false
              AND d.client_po_id = ${body.clientPoId}
              AND oa.activation_date >= ${body.billingPeriodStart}
              AND oa.activation_date <= ${body.billingPeriodEnd}
            ORDER BY oa.activation_date, d.drop_number
          `
        : await sql`
            SELECT d.id as drop_id, d.drop_number, d.lid, d.client_po_id,
                   oa.id as oes_activation_id, oa.activation_date::DATE as activation_date,
                   COALESCE(cpo.price_per_drop, ${defaultPrice}) as price_per_drop
            FROM drops d
            INNER JOIN oes_activations oa ON oa.drop_id = d.id
            LEFT JOIN client_purchase_orders cpo ON cpo.id = d.client_po_id
            WHERE d.project_id = ${projectId} AND d.invoiced = false
              AND oa.activation_date >= ${body.billingPeriodStart}
              AND oa.activation_date <= ${body.billingPeriodEnd}
            ORDER BY oa.activation_date, d.drop_number
          `;
      const drops = dropsForPeriod;

      if (drops.length === 0) {
        return apiResponse.badRequest(res, 'No uninvoiced activated drops found for the specified period');
      }

      // Generate invoice number
      const invoiceNumber = await sql`SELECT generate_customer_invoice_number() as num`;
      const invNum = invoiceNumber[0]?.num;

      // Create invoice
      const invoiceResult = await sql`
        INSERT INTO customer_invoices (
          invoice_number, project_id, client_id, client_po_id,
          billing_period_start, billing_period_end,
          tax_rate, due_date,
          notes, status, created_by
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
          'draft',
          ${userId || 'system'}
        )
        RETURNING *
      `;

      const newInvoice = invoiceResult[0];
      if (!newInvoice) {
        return apiResponse.internalError(res, new Error('Failed to create invoice'));
      }

      // Add line items for each drop
      for (const drop of drops) {
        const price = Number(drop.price_per_drop) || defaultPrice;
        const lineTotal = price;
        const itemTax = Math.round(lineTotal * taxRate / 100 * 100) / 100;

        await sql`
          INSERT INTO customer_invoice_items (
            invoice_id, drop_id, oes_activation_id,
            drop_number, activation_date, description,
            unit_price, quantity, tax_amount, line_total,
            income_type
          ) VALUES (
            ${newInvoice.id},
            ${drop.drop_id},
            ${drop.oes_activation_id},
            ${drop.drop_number},
            ${drop.activation_date},
            ${`Activation: ${drop.drop_number}${drop.lid ? ` (LID: ${drop.lid})` : ''}`},
            ${price},
            1,
            ${itemTax},
            ${lineTotal},
            'activation'
          )
        `;

        // Mark drop as invoiced
        await sql`
          UPDATE drops
          SET invoiced = true, invoice_id = ${newInvoice.id}
          WHERE id = ${drop.drop_id}
        `;
      }

      // Calculate totals
      await sql`SELECT calculate_invoice_totals(${newInvoice.id})`;

      // Get refreshed invoice with joined data
      const created = await sql`
        SELECT
          ci.*,
          c.company_name as client_name,
          p.project_name as project_name,
          cpo.po_number as client_po_number
        FROM customer_invoices ci
        LEFT JOIN clients c ON c.id = ci.client_id
        LEFT JOIN projects p ON p.id = ci.project_id
        LEFT JOIN client_purchase_orders cpo ON cpo.id = ci.client_po_id
        WHERE ci.id = ${newInvoice.id}
      `;

      log.info('Customer invoice generated', {
        invoiceId: newInvoice.id,
        invoiceNumber: invNum,
        projectId,
        dropsCount: drops.length,
        clientPoId: body.clientPoId,
      });

      return apiResponse.created(res, {
        invoice: transformInvoice(created[0] || newInvoice),
        dropsInvoiced: drops.length,
      });
    } catch (error) {
      log.error('Failed to generate customer invoice', { projectId, error });
      return apiResponse.databaseError(res, error, 'Failed to generate customer invoice');
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

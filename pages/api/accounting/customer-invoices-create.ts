/**
 * Customer Invoice Create API (standalone, not project-linked)
 * POST — create invoice with line items
 */

import type { NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { sql } from '@/lib/neon';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);

  const { clientId, invoiceDate, dueDate, billingPeriodStart, billingPeriodEnd, taxRate, notes, items } = req.body;
  if (!clientId) return apiResponse.badRequest(res, 'clientId is required');
  if (!items || !Array.isArray(items) || items.length === 0) return apiResponse.badRequest(res, 'items required');

  const userId = req.user.id;

  // Calculate totals
  const rate = taxRate ?? 15;
  let subtotal = 0;
  for (const item of items) {
    subtotal += (item.quantity || 1) * item.unitPrice;
  }
  subtotal = Math.round(subtotal * 100) / 100;
  const taxAmount = Math.round(subtotal * (rate / 100) * 100) / 100;
  const totalAmount = subtotal + taxAmount;

  const today = new Date().toISOString().split('T')[0];
  const invDate = invoiceDate || today;
  const bpStart = billingPeriodStart || invDate;
  const bpEnd = billingPeriodEnd || invDate;

  // Find project from client (use first project if exists)
  const projRows = (await sql`
    SELECT id FROM projects WHERE client_id = ${clientId}::UUID LIMIT 1
  `) as Row[];
  const projectId = projRows[0]?.id || clientId;

  // Insert invoice header and all line items atomically.
  // The invoice number is generated inside the transaction to avoid race conditions.
  let invoiceId: string;
  let invoiceNumber: string;

  await sql`BEGIN`;
  try {
    const invRows = (await sql`
      INSERT INTO customer_invoices (
        invoice_number, project_id, client_id, billing_period_start, billing_period_end,
        subtotal, tax_rate, tax_amount, total_amount, invoice_date, due_date,
        notes, status, created_by
      ) VALUES (
        'INV-' || LPAD(
          (COALESCE(
            (SELECT MAX(CAST(REGEXP_REPLACE(invoice_number, '[^0-9]', '', 'g') AS INTEGER))
             FROM customer_invoices
             WHERE invoice_number ~ '^INV-[0-9]+$'),
            0
          ) + 1)::TEXT,
          5, '0'
        ),
        ${projectId}::UUID, ${clientId}::UUID, ${bpStart}, ${bpEnd},
        ${subtotal}, ${rate}, ${taxAmount}, ${totalAmount}, ${invDate},
        ${dueDate || null}, ${notes || null}, 'draft', ${userId}
      ) RETURNING id, invoice_number
    `) as Row[];

    invoiceId = invRows[0].id;
    invoiceNumber = invRows[0].invoice_number;

    for (const item of items) {
      const lineTotal = Math.round((item.quantity || 1) * item.unitPrice * 100) / 100;
      const lineTax = Math.round(lineTotal * (rate / 100) * 100) / 100;
      await sql`
        INSERT INTO customer_invoice_items (invoice_id, drop_number, description, unit_price, quantity, tax_amount, line_total, income_type)
        VALUES (${invoiceId}::UUID, ${item.dropNumber || 'MANUAL'}, ${item.description}, ${item.unitPrice},
          ${item.quantity || 1}, ${lineTax}, ${lineTotal}, ${item.incomeType || 'other'})
      `;
    }

    await sql`COMMIT`;
  } catch (txErr) {
    await sql`ROLLBACK`;
    throw txErr;
  }

  log.info('Customer invoice created', { invoiceNumber, totalAmount });
  return apiResponse.created(res, { id: invoiceId, invoiceNumber });
}

export default withAuth(withErrorHandler(handler));

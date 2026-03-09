/**
 * Recurring Invoices API
 * GET  — list recurring invoices
 * POST — create recurring invoice
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { sql } from '@/lib/neon';
import {
  getRecurringInvoices,
  createRecurringInvoice,
} from '@/modules/accounting/services/recurringInvoiceService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { status, clientId, limit, offset } = req.query;
    const result = await getRecurringInvoices({
      status: status as string,
      clientId: clientId as string,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return apiResponse.success(res, result);
  }

  if (req.method === 'POST') {
    const userId = (req as unknown as { user?: { id: string } }).user?.id;
    if (!userId) return apiResponse.unauthorized(res, 'Unauthorized');
    try {
      const item = await createRecurringInvoice(req.body, userId);
      return apiResponse.success(res, item);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Create failed';
      log.error('Recurring invoice create failed', { error: err }, 'accounting-api');
      return apiResponse.badRequest(res, msg);
    }
  }

  if (req.method === 'PUT') {
    const { id, templateName, frequency, nextRunDate, description, lineItems } = req.body;
    if (!id) return apiResponse.badRequest(res, 'id is required');
    try {
      if (lineItems) {
        let subtotal = 0;
        for (const l of lineItems) subtotal += (l.quantity || 1) * (l.unitPrice || 0);
        const taxAmount = Math.round(subtotal * 0.15 * 100) / 100;
        await sql`
          UPDATE recurring_invoices SET
            template_name = COALESCE(${templateName || null}, template_name),
            frequency = COALESCE(${frequency || null}, frequency),
            next_run_date = COALESCE(${nextRunDate || null}, next_run_date),
            description = COALESCE(${description || null}, description),
            line_items = ${JSON.stringify(lineItems)}::JSONB,
            subtotal = ${subtotal},
            tax_amount = ${taxAmount},
            total_amount = ${subtotal + taxAmount},
            updated_at = NOW()
          WHERE id = ${id}::UUID AND status IN ('active', 'paused')
        `;
      } else {
        await sql`
          UPDATE recurring_invoices SET
            template_name = COALESCE(${templateName || null}, template_name),
            frequency = COALESCE(${frequency || null}, frequency),
            next_run_date = COALESCE(${nextRunDate || null}, next_run_date),
            description = COALESCE(${description || null}, description),
            updated_at = NOW()
          WHERE id = ${id}::UUID AND status IN ('active', 'paused')
        `;
      }
      log.info('Recurring invoice updated', { id });
      return apiResponse.success(res, { updated: true });
    } catch (err) {
      log.error('Recurring invoice update failed', { error: err }, 'accounting-api');
      return apiResponse.badRequest(res, 'Update failed');
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'PUT']);
}

export default withAuth(withErrorHandler(handler));

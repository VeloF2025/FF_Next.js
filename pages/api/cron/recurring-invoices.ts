/**
 * Recurring Invoices Cron
 * Generates customer invoices for all active recurring templates that are due
 *
 * Schedule: 0 6 * * * (6 AM daily)
 * Auth: CRON_SECRET header or withAuth
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/neon';
import { generateInvoiceFromRecurring } from '@/modules/accounting/services/recurringInvoiceService';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  // Auth: cron secret (mandatory) or session cookie
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    log.error('CRON_SECRET not configured — rejecting cron request');
    return apiResponse.error(res, 'Cron endpoint misconfigured', 503);
  }
  if (cronSecret !== expectedSecret && !req.headers.cookie) {
    return apiResponse.unauthorized(res, 'Invalid cron secret');
  }

  try {
    // Find all active recurring invoices due today or earlier
    const dueItems = await sql`
      SELECT id, template_name, client_id
      FROM recurring_invoices
      WHERE status = 'active'
        AND next_run_date <= CURRENT_DATE
      ORDER BY next_run_date ASC
    `;

    if (dueItems.length === 0) {
      return apiResponse.success(res, { processed: 0, message: 'No recurring invoices due' });
    }

    const results: { id: string; templateName: string; invoiceId?: string; error?: string }[] = [];

    for (const item of dueItems) {
      try {
        const invoiceId = await generateInvoiceFromRecurring(String(item.id), SYSTEM_USER_ID);
        results.push({ id: String(item.id), templateName: String(item.template_name), invoiceId });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error('Failed to generate recurring invoice', { id: item.id, error: message }, 'cron');
        results.push({ id: String(item.id), templateName: String(item.template_name), error: message });
      }
    }

    const succeeded = results.filter(r => r.invoiceId).length;
    const failed = results.filter(r => r.error).length;

    log.info('Recurring invoices cron completed', { total: dueItems.length, succeeded, failed }, 'cron');

    return apiResponse.success(res, {
      processed: dueItems.length,
      succeeded,
      failed,
      results,
    });
  } catch (err) {
    log.error('Recurring invoices cron failed', { error: err }, 'cron');
    return apiResponse.badRequest(res, 'Cron job failed');
  }
}

export default withErrorHandler(handler);

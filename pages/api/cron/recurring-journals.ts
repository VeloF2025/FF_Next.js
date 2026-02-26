/**
 * Recurring Journals Cron
 * Posts journal entries for all active recurring templates that are due
 *
 * Schedule: 0 6 * * * (6 AM daily)
 * Auth: CRON_SECRET header or withAuth
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/neon';
import { generateJournalFromRecurring } from '@/modules/accounting/services/recurringJournalService';

const CRON_SECRET = process.env.CRON_SECRET || '';
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  // Auth: cron secret or session cookie
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== CRON_SECRET && !req.headers.cookie) {
    return apiResponse.unauthorized(res, 'Invalid cron secret');
  }

  try {
    // Find all active recurring journals due today or earlier
    const dueItems = await sql`
      SELECT id, template_name
      FROM recurring_journals
      WHERE status = 'active'
        AND next_run_date <= CURRENT_DATE
      ORDER BY next_run_date ASC
    `;

    if (dueItems.length === 0) {
      return apiResponse.success(res, { processed: 0, message: 'No recurring journals due' });
    }

    const results: { id: string; templateName: string; journalId?: string; error?: string }[] = [];

    for (const item of dueItems) {
      try {
        const journalId = await generateJournalFromRecurring(String(item.id), SYSTEM_USER_ID);
        results.push({ id: String(item.id), templateName: String(item.template_name), journalId });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error('Failed to generate recurring journal', { id: item.id, error: message }, 'cron');
        results.push({ id: String(item.id), templateName: String(item.template_name), error: message });
      }
    }

    const succeeded = results.filter(r => r.journalId).length;
    const failed = results.filter(r => r.error).length;

    log.info('Recurring journals cron completed', { total: dueItems.length, succeeded, failed }, 'cron');

    return apiResponse.success(res, {
      processed: dueItems.length,
      succeeded,
      failed,
      results,
    });
  } catch (err) {
    log.error('Recurring journals cron failed', { error: err }, 'cron');
    return apiResponse.badRequest(res, 'Cron job failed');
  }
}

export default withErrorHandler(handler);

/**
 * Journal Entry Actions API
 * POST /api/accounting/journal-entries-action - Post or reverse an entry
 * Body: { id, action: 'post' | 'reverse', userId }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  postJournalEntry,
  reverseJournalEntry,
} from '@/modules/accounting/services/journalEntryService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { id, action } = req.body;
    const userId = (req as unknown as { user?: { id: string } }).user?.id || req.body.userId;
    if (!id || !action) {
      return apiResponse.badRequest(res, 'id and action are required');
    }
    if (!userId) {
      return apiResponse.badRequest(res, 'userId is required (login or provide in body)');
    }

    let result;
    switch (action) {
      case 'post':
        result = await postJournalEntry(id, userId);
        break;
      case 'reverse':
        result = await reverseJournalEntry(id, userId);
        break;
      default:
        return apiResponse.badRequest(res, `Invalid action: ${action}. Use post or reverse`);
    }

    return apiResponse.success(res, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to perform journal entry action';
    log.error('Failed to perform journal entry action', { error: err }, 'accounting-api');
    return apiResponse.badRequest(res, message);
  }
}

export default withAuth(withErrorHandler(handler));

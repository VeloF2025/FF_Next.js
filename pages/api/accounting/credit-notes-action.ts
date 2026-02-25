/**
 * Credit Note Actions API
 * POST /api/accounting/credit-notes-action
 *   action: approve
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { approveCreditNote } from '@/modules/accounting/services/creditNoteService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { action, creditNoteId, userId: bodyUserId } = req.body;
    const userId = bodyUserId || (req as unknown as { user?: { id: string } }).user?.id;

    if (!action || !creditNoteId) {
      return apiResponse.badRequest(res, 'action and creditNoteId are required');
    }

    if (!userId) return apiResponse.badRequest(res, 'userId is required');

    switch (action) {
      case 'approve': {
        const creditNote = await approveCreditNote(creditNoteId, userId);
        return apiResponse.success(res, creditNote);
      }
      default:
        return apiResponse.badRequest(res, `Unknown action: ${action}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Action failed';
    log.error('Credit note action failed', { error: err }, 'accounting-api');
    return apiResponse.badRequest(res, message);
  }
}

export default withAuth(withErrorHandler(handler));

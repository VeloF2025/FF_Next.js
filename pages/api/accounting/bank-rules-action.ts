/**
 * Bank Rules Action API
 * POST — delete, toggle, or apply rules
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { deleteRule, toggleRule, applyRules } from '@/modules/accounting/services/bankRulesService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!);

  const userId = String((req as Record<string, unknown>).userId || '');
  const { action, id, isActive, bankAccountId } = req.body;

  try {
    switch (action) {
      case 'delete':
        if (!id) return apiResponse.badRequest(res, 'id required');
        await deleteRule(id);
        return apiResponse.success(res, { deleted: true });

      case 'toggle':
        if (!id) return apiResponse.badRequest(res, 'id required');
        await toggleRule(id, isActive !== false);
        return apiResponse.success(res, { toggled: true });

      case 'apply':
        if (!bankAccountId) return apiResponse.badRequest(res, 'bankAccountId required');
        const result = await applyRules(bankAccountId, userId);
        return apiResponse.success(res, result);

      default:
        return apiResponse.badRequest(res, `Unknown action: ${action}`);
    }
  } catch (err) {
    log.error('Bank rules action failed', { action, error: err }, 'accounting-api');
    return apiResponse.badRequest(res, err instanceof Error ? err.message : 'Action failed');
  }
}

export default withAuth(withErrorHandler(handler));

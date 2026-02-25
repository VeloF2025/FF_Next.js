/**
 * Bank Categorisation Rules API
 * GET  — list all rules
 * POST — create a new rule
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { getRules, createRule } from '@/modules/accounting/services/bankRulesService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = String((req as Record<string, unknown>).userId || '');

  if (req.method === 'GET') {
    const rules = await getRules();
    return apiResponse.success(res, { items: rules });
  }

  if (req.method === 'POST') {
    const { ruleName, matchField, matchType, matchPattern, glAccountId, supplierId, descriptionTemplate, priority, autoCreateEntry } = req.body;
    if (!ruleName || !matchField || !matchType || !matchPattern || !glAccountId) {
      return apiResponse.badRequest(res, 'ruleName, matchField, matchType, matchPattern, and glAccountId are required');
    }
    const rule = await createRule({
      ruleName, matchField, matchType, matchPattern, glAccountId,
      supplierId: supplierId || undefined,
      descriptionTemplate: descriptionTemplate || undefined,
      priority: priority || 100,
      autoCreateEntry: autoCreateEntry !== false,
    }, userId);
    return apiResponse.success(res, rule);
  }

  return apiResponse.methodNotAllowed(res, req.method!);
}

export default withAuth(withErrorHandler(handler));

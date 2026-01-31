/**
 * API endpoint for budget availability check
 * PRD-057: Project Budget Tracking System
 *
 * POST /api/budget/check - Check if amount is within budget
 *
 * Used by PO creation flow to validate before submission
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { BudgetCheckResult } from '@/types/budget';
import { withErrorHandler } from '@/lib/api-error-handler';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }
  const { projectId, amount, categoryId } = req.body;

  // Validate required fields
  if (!projectId) {
    return apiResponse.validationError(res, {
      projectId: 'Project ID is required',
    });
  }

  if (amount === undefined || amount === null || isNaN(Number(amount))) {
    return apiResponse.validationError(res, {
      amount: 'Valid amount is required',
    });
  }

  const requestedAmount = Number(amount);

  try {
    // Call database function to check availability
    const result = await sql`
      SELECT check_budget_availability(
        ${projectId}::uuid,
        ${requestedAmount}::decimal,
        ${categoryId || null}::uuid
      ) as result
    `;

    if (result.length === 0 || !result[0]) {
      return apiResponse.internalError(res, new Error('Budget check returned no result'));
    }

    const checkResult = result[0].result as BudgetCheckResult;

    log.info('Budget check performed', {
      projectId,
      amount: requestedAmount,
      categoryId,
      allowed: checkResult.allowed,
      reason: checkResult.reason,
    });

    return apiResponse.success(res, checkResult);
  } catch (error) {
    // If the function doesn't exist yet (migration not run), use fallback
    if ((error as Error).message?.includes('check_budget_availability')) {
      log.warn('Budget check function not available, using fallback');
      return apiResponse.success(res, {
        allowed: true,
        reason: 'no_budget',
        available: 0,
        requested: requestedAmount,
        allowOverride: false,
        utilizationAfter: 0,
        utilizationBefore: 0,
        warning: false,
      } as BudgetCheckResult);
    }

    log.error('Failed to check budget', { projectId, amount: requestedAmount, error });
    return apiResponse.databaseError(res, error, 'Failed to check budget availability');
  }
}));

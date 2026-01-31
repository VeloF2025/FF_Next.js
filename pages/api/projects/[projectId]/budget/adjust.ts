/**
 * API endpoint for manual budget adjustments
 * PRD-057: Project Budget Tracking System
 *
 * POST /api/projects/[projectId]/budget/adjust - Adjust budget amount
 *
 * Admin only - requires reason for audit trail
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = createLoggedSql(process.env.DATABASE_URL!);

type AdjustmentType = 'increase' | 'decrease' | 'reallocation';

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }
    const userId = (req as AuthenticatedNextApiRequest).user.id;
  const projectId = req.query.projectId as string;
  const { adjustmentType, amount, reason, categoryId } = req.body;

  // Validate project ID
  if (!projectId) {
    return apiResponse.validationError(res, {
      projectId: 'Project ID is required',
    });
  }

  // Validate adjustment type
  if (!adjustmentType || !['increase', 'decrease', 'reallocation'].includes(adjustmentType)) {
    return apiResponse.validationError(res, {
      adjustmentType: 'Valid adjustment type required (increase, decrease, reallocation)',
    });
  }

  // Validate amount
  if (amount === undefined || amount === null || isNaN(Number(amount)) || Number(amount) <= 0) {
    return apiResponse.validationError(res, {
      amount: 'Positive amount is required',
    });
  }

  // Validate reason (required for audit)
  if (!reason || reason.trim().length < 5) {
    return apiResponse.validationError(res, {
      reason: 'Reason is required (minimum 5 characters)',
    });
  }

  const adjustmentAmount = Number(amount);
  const adjType = adjustmentType as AdjustmentType;

  try {
    // Get existing budget
    const budgets = await sql`
      SELECT * FROM project_budgets WHERE project_id = ${projectId}
    `;

    if (budgets.length === 0 || !budgets[0]) {
      return apiResponse.notFound(res, 'Budget', projectId);
    }

    const budget = budgets[0];

    // Check if budget is locked
    if (budget.status === 'locked' || budget.status === 'closed') {
      return apiResponse.forbidden(res, 'Cannot adjust locked or closed budget');
    }

    // Calculate new total
    let newTotal = Number(budget.total_budget);
    const previousTotal = newTotal;

    if (adjType === 'increase') {
      newTotal += adjustmentAmount;
    } else if (adjType === 'decrease') {
      newTotal -= adjustmentAmount;
      if (newTotal < 0) {
        return apiResponse.validationError(res, {
          amount: 'Decrease amount would result in negative budget',
        });
      }
    }
    // reallocation doesn't change total, just moves between categories

    // Start transaction
    await sql`BEGIN`;

    try {
      // Update budget total (if not reallocation)
      if (adjType !== 'reallocation') {
        await sql`
          UPDATE project_budgets
          SET total_budget = ${newTotal},
              updated_at = NOW()
          WHERE id = ${budget.id}
        `;
      }

      // Create transaction record
      await sql`
        INSERT INTO budget_transactions (
          project_budget_id, category_id, transaction_type,
          amount, description, created_by
        ) VALUES (
          ${budget.id},
          ${categoryId || null},
          'adjustment',
          ${adjType === 'decrease' ? -adjustmentAmount : adjustmentAmount},
          ${`Budget ${adjType}: ${reason}`},
          ${userId || 'system'}
        )
      `;

      // Check thresholds (may create alerts)
      await sql`SELECT check_budget_thresholds(${budget.id})`;

      await sql`COMMIT`;

      // Get updated budget
      const updatedBudgetRows = await sql`
        SELECT * FROM project_budgets WHERE id = ${budget.id}
      `;
      const updatedBudget = updatedBudgetRows[0];

      log.info('Budget adjusted', {
        budgetId: budget.id,
        projectId,
        adjustmentType: adjType,
        previousTotal,
        newTotal,
        amount: adjustmentAmount,
        reason,
        userId,
      });

      return apiResponse.success(res, {
        message: 'Budget adjusted successfully',
        adjustment: {
          type: adjType,
          amount: adjustmentAmount,
          previousTotal,
          newTotal,
          reason,
        },
        budget: updatedBudget ? {
          id: updatedBudget.id as string,
          totalBudget: Number(updatedBudget.total_budget),
          availableBudget: Number(updatedBudget.available_budget),
          committedAmount: Number(updatedBudget.committed_amount),
        } : null,
      });
    } catch (error) {
      await sql`ROLLBACK`;
      throw error;
    }
  } catch (error) {
    log.error('Failed to adjust budget', { projectId, adjustmentType: adjType, amount: adjustmentAmount, error });
    return apiResponse.databaseError(res, error, 'Failed to adjust budget');
  }
}));

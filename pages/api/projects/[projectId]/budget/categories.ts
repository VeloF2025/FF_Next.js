/**
 * API endpoint for budget category management
 * PRD-057: Project Budget Tracking System
 *
 * GET /api/projects/[projectId]/budget/categories - List categories
 * POST /api/projects/[projectId]/budget/categories - Add custom category (admin)
 * PUT /api/projects/[projectId]/budget/categories - Update allocation
 * DELETE /api/projects/[projectId]/budget/categories - Delete custom category
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { BudgetCategory } from '@/types/budget';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
    const userId = (req as AuthenticatedNextApiRequest).user.id;
  const projectId = req.query.projectId as string;
  const categoryId = req.query.categoryId as string | undefined;

  if (!projectId) {
    return apiResponse.validationError(res, {
      projectId: 'Project ID is required',
    });
  }

  // GET - List categories
  if (req.method === 'GET') {
    try {
      // Get budget for project
      const budgets = await sql`
        SELECT id FROM project_budgets WHERE project_id = ${projectId}
      `;

      if (budgets.length === 0 || !budgets[0]) {
        return apiResponse.success(res, {
          categories: [],
          message: 'No budget exists for this project',
        });
      }

      const budgetId = budgets[0].id as string;

      // Get categories
      const categories = await sql`
        SELECT
          id, project_budget_id, category_code, category_name,
          allocated_amount, committed_amount, actual_amount, available_amount,
          is_custom, sort_order, created_at, updated_at
        FROM budget_categories
        WHERE project_budget_id = ${budgetId}
        ORDER BY sort_order ASC
      `;

      // Calculate totals
      const totals = categories.reduce(
        (acc, cat) => ({
          allocated: acc.allocated + Number(cat.allocated_amount || 0),
          committed: acc.committed + Number(cat.committed_amount || 0),
          actual: acc.actual + Number(cat.actual_amount || 0),
          available: acc.available + Number(cat.available_amount || 0),
        }),
        { allocated: 0, committed: 0, actual: 0, available: 0 }
      );

      return apiResponse.success(res, {
        categories: categories.map(transformCategory),
        totals,
      });
    } catch (error) {
      log.error('Failed to fetch categories', { projectId, error });
      return apiResponse.databaseError(res, error, 'Failed to fetch categories');
    }
  }

  // POST - Add custom category
  if (req.method === 'POST') {
    try {
      const { categoryCode, categoryName, allocatedAmount } = req.body;

      // Validate required fields
      const errors: Record<string, string> = {};
      if (!categoryCode) errors.categoryCode = 'Category code is required';
      if (!categoryName) errors.categoryName = 'Category name is required';

      if (Object.keys(errors).length > 0) {
        return apiResponse.validationError(res, errors);
      }

      // Validate category code format (uppercase, alphanumeric, underscores)
      if (!/^[A-Z][A-Z0-9_]*$/.test(categoryCode)) {
        return apiResponse.validationError(res, {
          categoryCode: 'Category code must be uppercase, start with letter, contain only letters, numbers, underscores',
        });
      }

      // Get budget
      const budgets = await sql`
        SELECT id FROM project_budgets WHERE project_id = ${projectId}
      `;

      if (budgets.length === 0 || !budgets[0]) {
        return apiResponse.notFound(res, 'Budget', projectId);
      }

      const budgetId = budgets[0].id as string;

      // Check for duplicate category code
      const existing = await sql`
        SELECT id FROM budget_categories
        WHERE project_budget_id = ${budgetId} AND category_code = ${categoryCode}
      `;

      if (existing.length > 0) {
        return apiResponse.conflict(res, `Category code '${categoryCode}' already exists`);
      }

      // Get max sort order
      const maxOrderResult = await sql`
        SELECT COALESCE(MAX(sort_order), 0) as max_order
        FROM budget_categories
        WHERE project_budget_id = ${budgetId}
      `;

      const newSortOrder = (Number(maxOrderResult[0]?.max_order) || 0) + 1;

      // Create category
      const result = await sql`
        INSERT INTO budget_categories (
          project_budget_id, category_code, category_name,
          allocated_amount, is_custom, sort_order, created_by
        ) VALUES (
          ${budgetId},
          ${categoryCode},
          ${categoryName},
          ${allocatedAmount || 0},
          true,
          ${newSortOrder},
          ${userId || 'system'}
        )
        RETURNING
          id, project_budget_id, category_code, category_name,
          allocated_amount, committed_amount, actual_amount, available_amount,
          is_custom, sort_order, created_by, created_at, updated_at
      `;

      const created = result[0];
      if (!created) {
        return apiResponse.internalError(res, new Error('Failed to create category'));
      }

      log.info('Custom category created', {
        categoryId: created.id,
        budgetId,
        categoryCode,
        userId,
      });

      return apiResponse.created(res, {
        category: transformCategory(created),
      });
    } catch (error) {
      log.error('Failed to create category', { projectId, error });
      return apiResponse.databaseError(res, error, 'Failed to create category');
    }
  }

  // PUT - Update category allocation
  if (req.method === 'PUT') {
    try {
      if (!categoryId) {
        return apiResponse.validationError(res, {
          categoryId: 'Category ID is required for updates',
        });
      }

      const { allocatedAmount, categoryName } = req.body;

      // Validate amount if provided
      if (allocatedAmount !== undefined && (isNaN(Number(allocatedAmount)) || Number(allocatedAmount) < 0)) {
        return apiResponse.validationError(res, {
          allocatedAmount: 'Allocated amount must be a non-negative number',
        });
      }

      // Get category
      const categories = await sql`
        SELECT bc.id, bc.is_custom, pb.project_id
        FROM budget_categories bc
        JOIN project_budgets pb ON pb.id = bc.project_budget_id
        WHERE bc.id = ${categoryId} AND pb.project_id = ${projectId}
      `;

      if (categories.length === 0 || !categories[0]) {
        return apiResponse.notFound(res, 'Category', categoryId);
      }

      // Update category
      const result = await sql`
        UPDATE budget_categories
        SET
          allocated_amount = COALESCE(${allocatedAmount !== undefined ? Number(allocatedAmount) : null}, allocated_amount),
          category_name = COALESCE(${categoryName || null}, category_name),
          updated_at = NOW()
        WHERE id = ${categoryId}
        RETURNING
          id, project_budget_id, category_code, category_name,
          allocated_amount, committed_amount, actual_amount, available_amount,
          is_custom, sort_order, created_by, created_at, updated_at
      `;

      const updated = result[0];
      log.info('Category updated', {
        categoryId,
        allocatedAmount,
        categoryName,
        userId,
      });

      return apiResponse.success(res, {
        category: updated ? transformCategory(updated) : null,
      });
    } catch (error) {
      log.error('Failed to update category', { projectId, categoryId, error });
      return apiResponse.databaseError(res, error, 'Failed to update category');
    }
  }

  // DELETE - Remove custom category
  if (req.method === 'DELETE') {
    try {
      if (!categoryId) {
        return apiResponse.validationError(res, {
          categoryId: 'Category ID is required for deletion',
        });
      }

      // Get category
      const categories = await sql`
        SELECT bc.id, bc.is_custom, pb.project_id
        FROM budget_categories bc
        JOIN project_budgets pb ON pb.id = bc.project_budget_id
        WHERE bc.id = ${categoryId} AND pb.project_id = ${projectId}
      `;

      if (categories.length === 0 || !categories[0]) {
        return apiResponse.notFound(res, 'Category', categoryId);
      }

      const category = categories[0];

      // Only allow deletion of custom categories
      if (!category.is_custom) {
        return apiResponse.forbidden(res, 'Cannot delete standard categories');
      }

      // Check for existing transactions
      const transactions = await sql`
        SELECT COUNT(*) as count FROM budget_transactions
        WHERE category_id = ${categoryId}
      `;

      if (Number(transactions[0]?.count || 0) > 0) {
        return apiResponse.forbidden(res, 'Cannot delete category with existing transactions');
      }

      // Delete category
      await sql`DELETE FROM budget_categories WHERE id = ${categoryId}`;

      log.info('Category deleted', { categoryId, userId });

      return apiResponse.success(res, {
        message: 'Category deleted successfully',
      });
    } catch (error) {
      log.error('Failed to delete category', { projectId, categoryId, error });
      return apiResponse.databaseError(res, error, 'Failed to delete category');
    }
  }

  // Method not allowed
  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'PUT', 'DELETE']);
}));

/**
 * Transform database category row to API response
 */
function transformCategory(row: Record<string, unknown>): Partial<BudgetCategory> {
  return {
    id: row.id as string,
    projectBudgetId: row.project_budget_id as string,
    categoryCode: row.category_code as string,
    categoryName: row.category_name as string,
    allocatedAmount: Number(row.allocated_amount || 0),
    committedAmount: Number(row.committed_amount || 0),
    actualAmount: Number(row.actual_amount || 0),
    availableAmount: Number(row.available_amount || 0),
    isCustom: row.is_custom as boolean,
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

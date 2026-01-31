/**
 * API endpoint for project budget management
 * PRD-057: Project Budget Tracking System
 *
 * GET /api/projects/[projectId]/budget - Get budget summary with categories
 * POST /api/projects/[projectId]/budget - Create new budget
 * PUT /api/projects/[projectId]/budget - Update budget settings
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type {
  ProjectBudget,
  BudgetCategory,
  BudgetSourceType,
} from '@/types/budget';
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

  if (!projectId) {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  // GET - Retrieve budget summary
  if (req.method === 'GET') {
    try {
      // Get budget for project
      const budgets = await sql`
        SELECT *
        FROM project_budgets
        WHERE project_id = ${projectId}
      `;

      if (budgets.length === 0 || !budgets[0]) {
        return apiResponse.success(res, {
          exists: false,
        });
      }

      const budget = budgets[0];

      // Get categories for budget
      const categories = await sql`
        SELECT *
        FROM budget_categories
        WHERE project_budget_id = ${budget.id}
        ORDER BY sort_order ASC
      `;

      // Calculate summary
      const utilizationPercent = budget.total_budget > 0
        ? Math.round((budget.committed_amount / budget.total_budget) * 100 * 100) / 100
        : 0;

      return apiResponse.success(res, {
        exists: true,
        budget: transformBudget(budget),
        categories: categories.map(transformCategory),
        summary: {
          totalBudget: Number(budget.total_budget),
          committed: Number(budget.committed_amount),
          actual: Number(budget.actual_amount),
          available: Number(budget.available_budget),
          variance: Number(budget.variance_amount),
          variancePercent: Number(budget.variance_percent),
          utilizationPercent,
        },
      });
    } catch (error) {
      log.error('Failed to fetch budget', { projectId, error });
      return apiResponse.databaseError(res, error, 'Failed to fetch budget');
    }
  }

  // POST - Create new budget
  if (req.method === 'POST') {
    try {
      const body = req.body;

      // Validate source type
      const sourceType = body.sourceType as BudgetSourceType;
      if (!['manual', 'boq', 'hybrid'].includes(sourceType)) {
        return apiResponse.badRequest(res, 'Invalid source type. Must be manual, boq, or hybrid');
      }

      // For manual entry, require totalBudget
      if (sourceType === 'manual' && (!body.totalBudget || body.totalBudget <= 0)) {
        return apiResponse.validationError(res, {
          totalBudget: 'Total budget is required for manual entry',
        });
      }

      // Check if budget already exists
      const existing = await sql`
        SELECT id FROM project_budgets WHERE project_id = ${projectId}
      `;

      if (existing.length > 0) {
        return apiResponse.conflict(res, 'Budget already exists for this project');
      }

      // Create budget
      const result = await sql`
        INSERT INTO project_budgets (
          project_id, source_type, boq_id,
          total_budget, currency,
          enforce_budget, allow_override,
          alert_threshold_warning, alert_threshold_critical,
          status, created_by
        ) VALUES (
          ${projectId},
          ${sourceType},
          ${body.boqId || null},
          ${body.totalBudget || 0},
          ${body.currency || 'ZAR'},
          ${body.enforceBudget !== false},
          ${body.allowOverride !== false},
          ${body.alertThresholdWarning || 80},
          ${body.alertThresholdCritical || 100},
          'draft',
          ${userId || 'system'}
        )
        RETURNING *
      `;

      const newBudget = result[0];
      if (!newBudget) {
        return apiResponse.internalError(res, new Error('Failed to create budget'));
      }

      // Seed default categories
      await sql`SELECT seed_default_budget_categories(${newBudget.id})`;

      // Update project budget status
      await sql`
        UPDATE projects
        SET budget_status = 'draft', budget_health = 'healthy'
        WHERE id = ${projectId}
      `;

      // Get created categories
      const categories = await sql`
        SELECT * FROM budget_categories
        WHERE project_budget_id = ${newBudget.id}
        ORDER BY sort_order ASC
      `;

      log.info('Budget created', {
        budgetId: newBudget.id,
        projectId,
        sourceType,
        totalBudget: body.totalBudget,
      });

      return apiResponse.created(res, {
        budget: transformBudget(newBudget),
        categories: categories.map(transformCategory),
      });
    } catch (error) {
      log.error('Failed to create budget', { projectId, error });
      return apiResponse.databaseError(res, error, 'Failed to create budget');
    }
  }

  // PUT - Update budget settings
  if (req.method === 'PUT') {
    try {
      const body = req.body;

      // Get existing budget
      const existing = await sql`
        SELECT * FROM project_budgets WHERE project_id = ${projectId}
      `;

      if (existing.length === 0 || !existing[0]) {
        return apiResponse.notFound(res, 'Budget', projectId);
      }

      const budget = existing[0];

      // Only allow updates to draft budgets (unless admin override)
      if (budget.status !== 'draft' && !body.adminOverride) {
        return apiResponse.forbidden(res, 'Cannot modify approved/locked budget');
      }

      // Update budget
      const result = await sql`
        UPDATE project_budgets
        SET
          total_budget = COALESCE(${body.totalBudget}, total_budget),
          enforce_budget = COALESCE(${body.enforceBudget}, enforce_budget),
          allow_override = COALESCE(${body.allowOverride}, allow_override),
          alert_threshold_warning = COALESCE(${body.alertThresholdWarning}, alert_threshold_warning),
          alert_threshold_critical = COALESCE(${body.alertThresholdCritical}, alert_threshold_critical),
          updated_at = NOW()
        WHERE id = ${budget.id}
        RETURNING *
      `;

      const updated = result[0];
      log.info('Budget updated', { budgetId: budget.id, projectId });

      return apiResponse.success(res, {
        budget: updated ? transformBudget(updated) : null,
      });
    } catch (error) {
      log.error('Failed to update budget', { projectId, error });
      return apiResponse.databaseError(res, error, 'Failed to update budget');
    }
  }

  // Method not allowed
  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'PUT']);
}));

/**
 * Transform database budget row to API response
 */
function transformBudget(row: Record<string, unknown>): Partial<ProjectBudget> {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    sourceType: row.source_type as BudgetSourceType,
    boqId: row.boq_id as string | undefined,
    totalBudget: Number(row.total_budget),
    currency: row.currency as string,
    committedAmount: Number(row.committed_amount),
    actualAmount: Number(row.actual_amount),
    availableBudget: Number(row.available_budget),
    varianceAmount: Number(row.variance_amount),
    variancePercent: Number(row.variance_percent),
    status: row.status as ProjectBudget['status'],
    enforceBudget: row.enforce_budget as boolean,
    allowOverride: row.allow_override as boolean,
    alertThresholdWarning: Number(row.alert_threshold_warning),
    alertThresholdCritical: Number(row.alert_threshold_critical),
    approvedBy: row.approved_by as string | undefined,
    approvedAt: row.approved_at as string | undefined,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Transform database category row to API response
 */
function transformCategory(row: Record<string, unknown>): Partial<BudgetCategory> {
  return {
    id: row.id as string,
    projectBudgetId: row.project_budget_id as string,
    categoryCode: row.category_code as string,
    categoryName: row.category_name as string,
    allocatedAmount: Number(row.allocated_amount),
    committedAmount: Number(row.committed_amount),
    actualAmount: Number(row.actual_amount),
    availableAmount: Number(row.available_amount),
    isCustom: row.is_custom as boolean,
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

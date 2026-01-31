/**
 * API endpoint for syncing budget from BOQ
 * PRD-057: Project Budget Tracking System
 *
 * POST /api/projects/[projectId]/budget/sync-boq - Sync budget from approved BOQ
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = createLoggedSql(process.env.DATABASE_URL!);

// BOQ category to Budget category mapping
const BOQ_CATEGORY_MAP: Record<string, string> = {
  materials: 'MATERIALS',
  material: 'MATERIALS',
  consumables: 'MATERIALS',
  equipment: 'EQUIPMENT',
  tools: 'EQUIPMENT',
  plant: 'EQUIPMENT',
  labor: 'LABOR',
  labour: 'LABOR',
  workforce: 'LABOR',
  subcontractor: 'SUBCONTRACT',
  subcontract: 'SUBCONTRACT',
  'sub-contractor': 'SUBCONTRACT',
  transport: 'TRANSPORT',
  logistics: 'TRANSPORT',
  delivery: 'TRANSPORT',
  overhead: 'OVERHEAD',
  admin: 'OVERHEAD',
  management: 'OVERHEAD',
  contingency: 'CONTINGENCY',
  reserve: 'CONTINGENCY',
  provisional: 'CONTINGENCY',
};

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }
    const userId = (req as AuthenticatedNextApiRequest).user.id;
  const projectId = req.query.projectId as string;
  const { boqId, createIfNotExists, overwrite } = req.body;

  if (!projectId) {
    return apiResponse.validationError(res, {
      projectId: 'Project ID is required',
    });
  }

  if (!boqId) {
    return apiResponse.validationError(res, {
      boqId: 'BOQ ID is required',
    });
  }

  try {
    // Verify BOQ exists and is approved
    const boqsResult = await sql`
      SELECT id, project_id, status, total_amount, currency
      FROM boqs
      WHERE id = ${boqId} AND project_id = ${projectId}
    `;

    if (boqsResult.length === 0 || !boqsResult[0]) {
      return apiResponse.notFound(res, 'BOQ', boqId);
    }

    const boq = boqsResult[0];
    const boqStatus = boq.status as string;
    const boqTotalAmount = Number(boq.total_amount) || 0;
    const boqCurrency = (boq.currency as string) || 'ZAR';

    // Check BOQ status - must be approved
    if (boqStatus !== 'approved' && boqStatus !== 'final') {
      return apiResponse.validationError(res, {
        boqId: `BOQ must be approved before syncing to budget. Current status: ${boqStatus}`,
      });
    }

    // Check existing budget
    const existingBudgetsResult = await sql`
      SELECT id, source_type, status
      FROM project_budgets
      WHERE project_id = ${projectId}
    `;

    let budgetId: string;
    let isNewBudget = false;

    if (existingBudgetsResult.length > 0 && existingBudgetsResult[0]) {
      const existingBudget = existingBudgetsResult[0];
      const existingSourceType = existingBudget.source_type as string;
      const existingStatus = existingBudget.status as string;

      // If budget exists and not overwrite mode, check if allowed
      if (!overwrite) {
        if (existingSourceType === 'manual') {
          return apiResponse.conflict(res, 'Manual budget exists. Use overwrite=true to replace with BOQ data.');
        }
        if (existingStatus === 'locked' || existingStatus === 'closed') {
          return apiResponse.forbidden(res, 'Cannot sync to locked or closed budget');
        }
      } else {
        // Check if locked before overwrite
        if (existingStatus === 'locked' || existingStatus === 'closed') {
          return apiResponse.forbidden(res, 'Cannot overwrite locked or closed budget');
        }
      }

      budgetId = existingBudget.id as string;
    } else if (createIfNotExists) {
      // Create new budget from BOQ
      const newBudgetResult = await sql`
        INSERT INTO project_budgets (
          project_id, source_type, boq_id,
          total_budget, currency,
          enforce_budget, allow_override,
          status, created_by
        ) VALUES (
          ${projectId},
          'boq',
          ${boqId},
          ${boqTotalAmount},
          ${boqCurrency},
          true,
          true,
          'draft',
          ${userId || 'system'}
        )
        RETURNING id
      `;

      const newBudget = newBudgetResult[0];
      if (!newBudget) {
        return apiResponse.internalError(res, new Error('Failed to create budget'));
      }

      budgetId = newBudget.id as string;
      isNewBudget = true;

      // Seed default categories for new budget
      await sql`SELECT seed_default_budget_categories(${budgetId})`;
    } else {
      return apiResponse.notFound(res, 'Budget', projectId);
    }

    // Get BOQ line items grouped by category
    const boqItems = await sql`
      SELECT
        LOWER(COALESCE(category, 'materials')) as category,
        SUM(total_amount) as total
      FROM boq_items
      WHERE boq_id = ${boqId}
      GROUP BY LOWER(COALESCE(category, 'materials'))
    `;

    // Start transaction for updates
    await sql`BEGIN`;

    try {
      // Update budget total from BOQ
      await sql`
        UPDATE project_budgets
        SET
          total_budget = ${boqTotalAmount},
          boq_id = ${boqId},
          source_type = 'boq',
          updated_at = NOW()
        WHERE id = ${budgetId}
      `;

      // Map BOQ categories to budget categories and update allocations
      const categoryUpdates: Array<{ code: string; amount: number }> = [];

      for (const item of boqItems) {
        const boqCategory = item.category as string;
        const budgetCategoryCode = mapBoqCategory(boqCategory);
        const amount = Number(item.total) || 0;

        // Find existing update for this category
        const existing = categoryUpdates.find(u => u.code === budgetCategoryCode);
        if (existing) {
          existing.amount += amount;
        } else {
          categoryUpdates.push({ code: budgetCategoryCode, amount });
        }
      }

      // Reset all category allocations if overwriting
      if (overwrite && !isNewBudget) {
        await sql`
          UPDATE budget_categories
          SET allocated_amount = 0, updated_at = NOW()
          WHERE project_budget_id = ${budgetId}
        `;
      }

      // Apply category allocations
      for (const update of categoryUpdates) {
        await sql`
          UPDATE budget_categories
          SET
            allocated_amount = allocated_amount + ${update.amount},
            updated_at = NOW()
          WHERE project_budget_id = ${budgetId}
            AND category_code = ${update.code}
        `;
      }

      // Create transaction record for the sync
      const boqIdPrefix = typeof boqId === 'string' ? boqId.slice(0, 8) : String(boqId).slice(0, 8);
      await sql`
        INSERT INTO budget_transactions (
          project_budget_id, transaction_type,
          source_type, source_id, source_number,
          amount, description, created_by
        ) VALUES (
          ${budgetId},
          'allocation',
          'boq',
          ${boqId},
          ${`BOQ-${boqIdPrefix}`},
          ${boqTotalAmount},
          ${`Budget synced from BOQ. ${categoryUpdates.length} categories updated.`},
          ${userId || 'system'}
        )
      `;

      // Update project budget status
      await sql`
        UPDATE projects
        SET budget_status = 'draft', budget_health = 'healthy'
        WHERE id = ${projectId}
      `;

      await sql`COMMIT`;

      // Get updated budget
      const updatedBudgetResult = await sql`
        SELECT * FROM project_budgets WHERE id = ${budgetId}
      `;
      const updatedBudget = updatedBudgetResult[0];

      // Get updated categories
      const categories = await sql`
        SELECT * FROM budget_categories
        WHERE project_budget_id = ${budgetId}
        ORDER BY sort_order ASC
      `;

      log.info('Budget synced from BOQ', {
        budgetId,
        boqId,
        projectId,
        totalBudget: boqTotalAmount,
        categoriesUpdated: categoryUpdates.length,
        isNewBudget,
        userId,
      });

      return apiResponse.success(res, {
        message: isNewBudget ? 'Budget created from BOQ' : 'Budget synced from BOQ',
        budget: updatedBudget ? {
          id: updatedBudget.id as string,
          totalBudget: Number(updatedBudget.total_budget) || 0,
          sourceType: updatedBudget.source_type as string,
          boqId: updatedBudget.boq_id as string,
        } : null,
        sync: {
          boqId,
          boqTotal: boqTotalAmount,
          categoriesUpdated: categoryUpdates.length,
          categoryBreakdown: categoryUpdates,
        },
        categories: categories.map(c => ({
          code: c.category_code as string,
          name: c.category_name as string,
          allocated: Number(c.allocated_amount) || 0,
        })),
      });
    } catch (error) {
      await sql`ROLLBACK`;
      throw error;
    }
  } catch (error) {
    log.error('Failed to sync budget from BOQ', { projectId, boqId, error });
    return apiResponse.databaseError(res, error, 'Failed to sync budget from BOQ');
  }
}));

/**
 * Map BOQ category name to budget category code
 */
function mapBoqCategory(boqCategory: string): string {
  const normalized = boqCategory.toLowerCase().trim();

  // Direct mapping
  if (BOQ_CATEGORY_MAP[normalized]) {
    return BOQ_CATEGORY_MAP[normalized];
  }

  // Partial matching
  for (const [key, value] of Object.entries(BOQ_CATEGORY_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return value;
    }
  }

  // Default to materials if no match
  return 'MATERIALS';
}

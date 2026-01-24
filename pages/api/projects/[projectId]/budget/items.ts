/**
 * Project Budget Items API
 * GET - List budget items for a project
 * POST - Create a budget item
 *
 * Created: 2026-01-17
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import type {
  BudgetItemWithCategory,
  BudgetItemsResponse,
  CreateBudgetItemRequest,
  FiberBudgetCategoryCode,
} from '@/types/procurement/material-catalog.types';
import { withAuth } from '@/lib/auth';

const DATABASE_URL = process.env.DATABASE_URL!;

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const sql = neon(DATABASE_URL);
  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  switch (req.method) {
    case 'GET':
      return handleGet(req, res, sql, projectId);
    case 'POST':
      return handlePost(req, res, sql, projectId);
    default:
      return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
  }
}

/**
 * GET /api/projects/[projectId]/budget/items
 * List budget items with optional filters
 */
async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql: any,
  projectId: string
) {
  try {
    const {
      categoryId,
      boqItemId,
      materialCatalogId,
      search,
      sortBy = 'description',
      sortOrder = 'asc',
    } = req.query;

    // Get project budget ID
    const budgetResult = await sql`
      SELECT id FROM project_budgets
      WHERE project_id = ${projectId}
      LIMIT 1
    `;

    if (budgetResult.length === 0) {
      return apiResponse.success(res, {
        items: [],
        totals: { budgeted: 0, committed: 0, actual: 0, available: 0 },
        count: 0,
      } as BudgetItemsResponse);
    }

    const projectBudgetId = budgetResult[0].id;

    // Build query with filters
    let query = `
      SELECT
        bi.*,
        bc.category_code,
        bc.category_name
      FROM budget_items bi
      JOIN budget_categories bc ON bc.id = bi.budget_category_id
      WHERE bi.project_budget_id = $1
    `;
    const params: unknown[] = [projectBudgetId];
    let paramIndex = 2;

    if (categoryId) {
      query += ` AND bi.budget_category_id = $${paramIndex++}`;
      params.push(categoryId);
    }

    if (boqItemId) {
      query += ` AND bi.boq_item_id = $${paramIndex++}`;
      params.push(boqItemId);
    }

    if (materialCatalogId) {
      query += ` AND bi.material_catalog_id = $${paramIndex++}`;
      params.push(materialCatalogId);
    }

    if (search && typeof search === 'string') {
      query += ` AND (LOWER(bi.description) LIKE $${paramIndex} OR LOWER(bi.item_code) LIKE $${paramIndex})`;
      params.push(`%${search.toLowerCase()}%`);
      paramIndex++;
    }

    // Add sorting
    const validSortColumns = ['item_code', 'description', 'budgeted_amount', 'variance_amount', 'category'];
    const sortColumn = sortBy === 'itemCode' ? 'bi.item_code' :
      sortBy === 'budgetedAmount' ? 'bi.budgeted_amount' :
      sortBy === 'varianceAmount' ? 'bi.variance_amount' :
      sortBy === 'category' ? 'bc.category_code' :
      'bi.description';
    const sortDir = sortOrder === 'desc' ? 'DESC' : 'ASC';

    query += ` ORDER BY ${sortColumn} ${sortDir}`;

    const items = await sql.unsafe(query, params);

    // Calculate totals
    const totalsQuery = `
      SELECT
        COALESCE(SUM(budgeted_amount), 0) as budgeted,
        COALESCE(SUM(committed_amount), 0) as committed,
        COALESCE(SUM(actual_amount), 0) as actual,
        COALESCE(SUM(available_amount), 0) as available
      FROM budget_items
      WHERE project_budget_id = $1
    `;
    const totalsResult = await sql.unsafe(totalsQuery, [projectBudgetId]);
    const totals = totalsResult[0] || {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mappedItems: BudgetItemWithCategory[] = items.map((row: any) => ({
      id: row.id,
      projectBudgetId: row.project_budget_id,
      budgetCategoryId: row.budget_category_id,
      materialCatalogId: row.material_catalog_id,
      boqItemId: row.boq_item_id,
      itemCode: row.item_code,
      description: row.description,
      category: row.category,
      uom: row.uom,
      budgetedQuantity: parseFloat(row.budgeted_quantity) || 0,
      budgetedRate: parseFloat(row.budgeted_rate) || 0,
      budgetedAmount: parseFloat(row.budgeted_amount) || 0,
      committedAmount: parseFloat(row.committed_amount) || 0,
      actualAmount: parseFloat(row.actual_amount) || 0,
      availableAmount: parseFloat(row.available_amount) || 0,
      varianceAmount: parseFloat(row.variance_amount) || 0,
      variancePercent: parseFloat(row.variance_percent) || 0,
      notes: row.notes,
      sortOrder: row.sort_order || 0,
      isManual: row.is_manual || false,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      categoryCode: row.category_code as FiberBudgetCategoryCode,
      categoryName: row.category_name,
    }));

    const response: BudgetItemsResponse = {
      items: mappedItems,
      totals: {
        budgeted: parseFloat(totals.budgeted) || 0,
        committed: parseFloat(totals.committed) || 0,
        actual: parseFloat(totals.actual) || 0,
        available: parseFloat(totals.available) || 0,
      },
      count: mappedItems.length,
    };

    return apiResponse.success(res, response);
  } catch (error) {
    return apiResponse.databaseError(res, error, 'Failed to fetch budget items');
  }
}

/**
 * POST /api/projects/[projectId]/budget/items
 * Create a manual budget item
 */
async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql: any,
  projectId: string
) {
  try {
    const body = req.body as CreateBudgetItemRequest;

    // Validate required fields
    if (!body.budgetCategoryId || !body.description || body.budgetedQuantity === undefined || body.budgetedRate === undefined) {
      return apiResponse.validationError(res, {
        budgetCategoryId: !body.budgetCategoryId ? 'Budget category is required' : [],
        description: !body.description ? 'Description is required' : [],
        budgetedQuantity: body.budgetedQuantity === undefined ? 'Budgeted quantity is required' : [],
        budgetedRate: body.budgetedRate === undefined ? 'Budgeted rate is required' : [],
      });
    }

    // Get project budget ID
    const budgetResult = await sql`
      SELECT id FROM project_budgets
      WHERE project_id = ${projectId}
      LIMIT 1
    `;

    if (budgetResult.length === 0) {
      return apiResponse.notFound(res, 'Project budget', projectId);
    }

    const projectBudgetId = budgetResult[0].id;

    // Verify budget category exists
    const categoryResult = await sql`
      SELECT id, category_code, category_name FROM budget_categories
      WHERE id = ${body.budgetCategoryId}
        AND project_budget_id = ${projectBudgetId}
    `;

    if (categoryResult.length === 0) {
      return apiResponse.notFound(res, 'Budget category', body.budgetCategoryId);
    }

    // Create budget item
    const result = await sql`
      INSERT INTO budget_items (
        project_budget_id,
        budget_category_id,
        material_catalog_id,
        boq_item_id,
        item_code,
        description,
        uom,
        budgeted_quantity,
        budgeted_rate,
        notes,
        sort_order,
        is_manual,
        created_by
      ) VALUES (
        ${projectBudgetId},
        ${body.budgetCategoryId},
        ${body.materialCatalogId || null},
        ${body.boqItemId || null},
        ${body.itemCode || null},
        ${body.description},
        ${body.uom || null},
        ${body.budgetedQuantity},
        ${body.budgetedRate},
        ${body.notes || null},
        ${body.sortOrder || 0},
        true,
        ${'system'}
      )
      RETURNING *
    `;

    const category = categoryResult[0];
    const row = result[0];

    const item: BudgetItemWithCategory = {
      id: row.id,
      projectBudgetId: row.project_budget_id,
      budgetCategoryId: row.budget_category_id,
      materialCatalogId: row.material_catalog_id,
      boqItemId: row.boq_item_id,
      itemCode: row.item_code,
      description: row.description,
      category: row.category,
      uom: row.uom,
      budgetedQuantity: parseFloat(row.budgeted_quantity) || 0,
      budgetedRate: parseFloat(row.budgeted_rate) || 0,
      budgetedAmount: parseFloat(row.budgeted_amount) || 0,
      committedAmount: 0,
      actualAmount: 0,
      availableAmount: parseFloat(row.budgeted_amount) || 0,
      varianceAmount: parseFloat(row.budgeted_amount) || 0,
      variancePercent: 100,
      notes: row.notes,
      sortOrder: row.sort_order || 0,
      isManual: true,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      categoryCode: category.category_code as FiberBudgetCategoryCode,
      categoryName: category.category_name,
    };

    return apiResponse.created(res, item, 'Budget item created successfully');
  } catch (error) {
    return apiResponse.databaseError(res, error, 'Failed to create budget item');
  }
}

export default withAuth(handler);

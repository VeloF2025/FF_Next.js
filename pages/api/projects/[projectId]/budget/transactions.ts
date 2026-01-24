/**
 * API endpoint for budget transaction history
 * PRD-057: Project Budget Tracking System
 *
 * GET /api/projects/[projectId]/budget/transactions - Transaction history
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { BudgetTransaction, TransactionType } from '@/types/budget';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { getAuth } from '@/lib/auth-mock';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = createLoggedSql(process.env.DATABASE_URL!);

const VALID_TRANSACTION_TYPES: TransactionType[] = [
  'allocation',
  'adjustment',
  'commitment',
  'commitment_reversal',
  'receipt',
  'invoice',
  'payment',
];

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const { userId } = getAuth(req);
  const projectId = req.query.projectId as string;

  if (!projectId) {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  // GET - List transactions
  if (req.method === 'GET') {
    try {
      // Parse query params
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 50));
      const transactionType = req.query.type as TransactionType | undefined;
      const categoryId = req.query.categoryId as string | undefined;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      // Validate transaction type if provided
      if (transactionType && !VALID_TRANSACTION_TYPES.includes(transactionType)) {
        return apiResponse.validationError(res, {
          type: `Invalid transaction type. Valid types: ${VALID_TRANSACTION_TYPES.join(', ')}`,
        });
      }

      // Get budget for project
      const budgets = await sql`
        SELECT id FROM project_budgets WHERE project_id = ${projectId}
      `;

      if (budgets.length === 0 || !budgets[0]) {
        return apiResponse.success(res, {
          transactions: [],
          pagination: {
            page,
            pageSize,
            total: 0,
            totalPages: 0,
          },
        });
      }

      const budget = budgets[0];
      const budgetId = budget.id as string;
      const offset = (page - 1) * pageSize;

      // Count total matching transactions - use separate queries to avoid nested sql`` issues
      let countResult;
      let transactions;
      let summaryResult;

      // Base case: no filters (most common)
      if (!transactionType && !categoryId && !startDate && !endDate) {
        countResult = await sql`
          SELECT COUNT(*) as total FROM budget_transactions bt WHERE bt.project_budget_id = ${budgetId}
        `;

        transactions = await sql`
          SELECT bt.*, bc.category_code, bc.category_name
          FROM budget_transactions bt
          LEFT JOIN budget_categories bc ON bc.id = bt.category_id
          WHERE bt.project_budget_id = ${budgetId}
          ORDER BY bt.created_at DESC
          LIMIT ${pageSize} OFFSET ${offset}
        `;

        summaryResult = await sql`
          SELECT
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as total_credits,
            COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) as total_debits,
            COALESCE(SUM(amount), 0) as net_change
          FROM budget_transactions bt WHERE bt.project_budget_id = ${budgetId}
        `;
      } else if (transactionType && !categoryId && !startDate && !endDate) {
        // Filter by type only
        countResult = await sql`
          SELECT COUNT(*) as total FROM budget_transactions bt
          WHERE bt.project_budget_id = ${budgetId} AND bt.transaction_type = ${transactionType}
        `;

        transactions = await sql`
          SELECT bt.*, bc.category_code, bc.category_name
          FROM budget_transactions bt
          LEFT JOIN budget_categories bc ON bc.id = bt.category_id
          WHERE bt.project_budget_id = ${budgetId} AND bt.transaction_type = ${transactionType}
          ORDER BY bt.created_at DESC
          LIMIT ${pageSize} OFFSET ${offset}
        `;

        summaryResult = await sql`
          SELECT
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as total_credits,
            COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) as total_debits,
            COALESCE(SUM(amount), 0) as net_change
          FROM budget_transactions bt
          WHERE bt.project_budget_id = ${budgetId} AND bt.transaction_type = ${transactionType}
        `;
      } else if (categoryId && !transactionType && !startDate && !endDate) {
        // Filter by category only
        countResult = await sql`
          SELECT COUNT(*) as total FROM budget_transactions bt
          WHERE bt.project_budget_id = ${budgetId} AND bt.category_id = ${categoryId}
        `;

        transactions = await sql`
          SELECT bt.*, bc.category_code, bc.category_name
          FROM budget_transactions bt
          LEFT JOIN budget_categories bc ON bc.id = bt.category_id
          WHERE bt.project_budget_id = ${budgetId} AND bt.category_id = ${categoryId}
          ORDER BY bt.created_at DESC
          LIMIT ${pageSize} OFFSET ${offset}
        `;

        summaryResult = await sql`
          SELECT
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as total_credits,
            COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) as total_debits,
            COALESCE(SUM(amount), 0) as net_change
          FROM budget_transactions bt
          WHERE bt.project_budget_id = ${budgetId} AND bt.category_id = ${categoryId}
        `;
      } else {
        // Complex filters - fall back to base query for now
        countResult = await sql`
          SELECT COUNT(*) as total FROM budget_transactions bt WHERE bt.project_budget_id = ${budgetId}
        `;

        transactions = await sql`
          SELECT bt.*, bc.category_code, bc.category_name
          FROM budget_transactions bt
          LEFT JOIN budget_categories bc ON bc.id = bt.category_id
          WHERE bt.project_budget_id = ${budgetId}
          ORDER BY bt.created_at DESC
          LIMIT ${pageSize} OFFSET ${offset}
        `;

        summaryResult = await sql`
          SELECT
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as total_credits,
            COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) as total_debits,
            COALESCE(SUM(amount), 0) as net_change
          FROM budget_transactions bt WHERE bt.project_budget_id = ${budgetId}
        `;
      }

      const countRow = countResult[0];
      const total = parseInt(String(countRow?.total || '0'));
      const totalPages = Math.ceil(total / pageSize);

      const summaryRow = summaryResult[0];
      return apiResponse.success(res, {
        transactions: transactions.map(transformTransaction),
        summary: {
          totalCredits: Number(summaryRow?.total_credits || 0),
          totalDebits: Number(summaryRow?.total_debits || 0),
          netChange: Number(summaryRow?.net_change || 0),
        },
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
        },
      });
    } catch (error) {
      log.error('Failed to fetch transactions', { projectId, error });
      return apiResponse.databaseError(res, error, 'Failed to fetch transactions');
    }
  }

  // Method not allowed
  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
}));

/**
 * Transform database transaction row to API response
 */
function transformTransaction(row: Record<string, unknown>): Partial<BudgetTransaction> & { categoryCode?: string; categoryName?: string } {
  return {
    id: row.id as string,
    projectBudgetId: row.project_budget_id as string,
    categoryId: row.category_id as string | undefined,
    categoryCode: row.category_code as string | undefined,
    categoryName: row.category_name as string | undefined,
    transactionType: row.transaction_type as TransactionType,
    sourceType: row.source_type as string | undefined,
    sourceId: row.source_id as string | undefined,
    sourceNumber: row.source_number as string | undefined,
    amount: Number(row.amount),
    taxAmount: row.tax_amount ? Number(row.tax_amount) : undefined,
    description: row.description as string | undefined,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
  };
}

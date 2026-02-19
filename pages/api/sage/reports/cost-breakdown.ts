/**
 * Cost Breakdown Matrix API
 *
 * GET - Returns expense accounts x BUs matrix with period filtering.
 *
 * Query params: fromDate, toDate (YYYY-MM-DD)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';

const logger = createLogger('api:sage:reports:cost-breakdown');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    const { fromDate, toDate } = req.query;

    const now = new Date();
    const defaultFrom = `${now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1}-03-01`;
    const defaultTo = now.toISOString().split('T')[0];

    const from = (fromDate as string) || defaultFrom;
    const to = (toDate as string) || defaultTo;

    // Get expense transactions grouped by account and BU
    const data = await sql`
      SELECT
        sa.name as account_name,
        sa.sage_account_id,
        sa.category_description,
        COALESCE(slt.ff_business_unit, 'Unallocated') as business_unit,
        SUM(slt.debit) as total_debit,
        SUM(slt.credit) as total_credit,
        SUM(slt.debit - slt.credit) as net_expense
      FROM sage_ledger_transactions slt
      LEFT JOIN sage_accounts sa ON sa.sage_account_id = slt.sage_account_id
      WHERE slt.transaction_date >= ${from}
        AND slt.transaction_date <= ${to}
        AND (
          LOWER(sa.category_description) LIKE '%expense%'
          OR LOWER(sa.category_description) LIKE '%cost of sales%'
          OR LOWER(sa.category_description) = 'cos'
        )
      GROUP BY sa.name, sa.sage_account_id, sa.category_description, slt.ff_business_unit
      HAVING SUM(slt.debit - slt.credit) != 0
      ORDER BY sa.category_description, sa.name, slt.ff_business_unit
    `;

    // Get unique BUs and accounts
    const buSet = new Set<string>();
    const accountMap = new Map<string, { name: string; category: string }>();

    for (const row of data) {
      buSet.add(row.business_unit as string);
      if (!accountMap.has(row.sage_account_id as string)) {
        accountMap.set(row.sage_account_id as string, {
          name: row.account_name as string,
          category: row.category_description as string,
        });
      }
    }

    const businessUnits = Array.from(buSet).sort();
    const accounts = Array.from(accountMap.entries()).map(([id, info]) => ({
      id,
      name: info.name,
      category: info.category,
    }));

    // Build matrix
    interface MatrixRow {
      accountId: string;
      accountName: string;
      category: string;
      amounts: Record<string, number>;
      total: number;
    }

    const matrix: MatrixRow[] = [];
    const matrixMap = new Map<string, MatrixRow>();

    for (const row of data) {
      const accountId = row.sage_account_id as string;
      const bu = row.business_unit as string;
      const amount = parseFloat(row.net_expense as string || '0');

      let matrixRow = matrixMap.get(accountId);
      if (!matrixRow) {
        const accountInfo = accountMap.get(accountId);
        matrixRow = {
          accountId,
          accountName: accountInfo?.name || 'Unknown',
          category: accountInfo?.category || 'Other',
          amounts: {},
          total: 0,
        };
        matrixMap.set(accountId, matrixRow);
        matrix.push(matrixRow);
      }

      matrixRow.amounts[bu] = amount;
      matrixRow.total += amount;
    }

    // Sort by total descending (highest expenses first)
    matrix.sort((a, b) => b.total - a.total);

    // Column totals
    const columnTotals: Record<string, number> = {};
    for (const row of matrix) {
      for (const [bu, amount] of Object.entries(row.amounts)) {
        columnTotals[bu] = (columnTotals[bu] || 0) + amount;
      }
    }

    // Find max for heatmap coloring
    const maxAmount = Math.max(...matrix.flatMap(r => Object.values(r.amounts)), 1);

    return apiResponse.success(res, {
      dateRange: { from, to },
      businessUnits,
      accounts,
      matrix,
      columnTotals,
      grandTotal: matrix.reduce((sum, r) => sum + r.total, 0),
      maxAmount,
    });
  } catch (error) {
    logger.error('Cost breakdown report failed', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

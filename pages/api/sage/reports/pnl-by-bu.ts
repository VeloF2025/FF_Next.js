/**
 * P&L by Business Unit Report API
 *
 * GET - Returns P&L structured as Revenue/COS/Gross Profit/Expenses/Net Income
 *       with columns per business unit, filterable by date range.
 *
 * Query params: fromDate, toDate (YYYY-MM-DD)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';

const logger = createLogger('api:sage:reports:pnl-by-bu');

// Standard P&L category ordering
const CATEGORY_ORDER = [
  'Revenue', 'Income', 'Sales',
  'Cost of Sales', 'COS',
  'Other Income',
  'Expenses', 'Operating Expenses', 'Expense',
  'Other Expenses',
];

function getCategoryGroup(category: string): string {
  const lower = (category || '').toLowerCase();
  if (lower.includes('revenue') || lower.includes('income') || lower.includes('sales')) {
    if (lower.includes('cost')) return 'Cost of Sales';
    if (lower.includes('other')) return 'Other Income';
    return 'Revenue';
  }
  if (lower.includes('cost of sales') || lower === 'cos') return 'Cost of Sales';
  if (lower.includes('expense')) {
    if (lower.includes('other')) return 'Other Expenses';
    return 'Expenses';
  }
  return 'Other';
}

function getCategorySortOrder(group: string): number {
  const idx = CATEGORY_ORDER.findIndex(c =>
    c.toLowerCase() === group.toLowerCase()
  );
  return idx >= 0 ? idx : 99;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    const { fromDate, toDate } = req.query;

    // Default to current financial year (March-Feb for SA)
    const now = new Date();
    const defaultFrom = `${now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1}-03-01`;
    const defaultTo = now.toISOString().split('T')[0];

    const from = (fromDate as string) || defaultFrom;
    const to = (toDate as string) || defaultTo;

    // Get all business units
    const buList = await sql`
      SELECT DISTINCT ff_business_unit
      FROM sage_ledger_transactions
      WHERE ff_business_unit IS NOT NULL
        AND transaction_date >= ${from}
        AND transaction_date <= ${to}
      ORDER BY ff_business_unit
    `;

    const businessUnits = buList.map(b => b.ff_business_unit as string);

    // Get P&L data grouped by account category and BU
    const data = await sql`
      SELECT
        sa.category_description,
        sa.reporting_group_description,
        sa.name as account_name,
        sa.sage_account_id,
        COALESCE(slt.ff_business_unit, 'Unallocated') as business_unit,
        SUM(slt.debit) as total_debit,
        SUM(slt.credit) as total_credit,
        SUM(slt.credit - slt.debit) as net_amount
      FROM sage_ledger_transactions slt
      LEFT JOIN sage_accounts sa ON sa.sage_account_id = slt.sage_account_id
      WHERE slt.transaction_date >= ${from}
        AND slt.transaction_date <= ${to}
      GROUP BY
        sa.category_description,
        sa.reporting_group_description,
        sa.name,
        sa.sage_account_id,
        slt.ff_business_unit
      ORDER BY sa.category_description, sa.name
    `;

    // Structure into P&L format
    interface PnLRow {
      accountName: string;
      accountId: string;
      reportingGroup: string;
      categoryGroup: string;
      amounts: Record<string, number>;
      total: number;
    }

    const rows: PnLRow[] = [];
    const rowMap = new Map<string, PnLRow>();

    for (const row of data) {
      const accountId = row.sage_account_id as string;
      const accountName = (row.account_name as string) || 'Unknown';
      const category = (row.category_description as string) || 'Other';
      const reportingGroup = (row.reporting_group_description as string) || '';
      const bu = row.business_unit as string;
      const netAmount = parseFloat(row.net_amount as string || '0');

      let pnlRow = rowMap.get(accountId);
      if (!pnlRow) {
        pnlRow = {
          accountName,
          accountId,
          reportingGroup,
          categoryGroup: getCategoryGroup(category),
          amounts: {},
          total: 0,
        };
        rowMap.set(accountId, pnlRow);
        rows.push(pnlRow);
      }

      pnlRow.amounts[bu] = (pnlRow.amounts[bu] || 0) + netAmount;
      pnlRow.total += netAmount;
    }

    // Sort by P&L category order
    rows.sort((a, b) => {
      const orderDiff = getCategorySortOrder(a.categoryGroup) - getCategorySortOrder(b.categoryGroup);
      if (orderDiff !== 0) return orderDiff;
      return a.accountName.localeCompare(b.accountName);
    });

    // Calculate section totals
    const sectionTotals: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      if (!sectionTotals[row.categoryGroup]) {
        sectionTotals[row.categoryGroup] = {};
      }
      for (const [bu, amount] of Object.entries(row.amounts)) {
        sectionTotals[row.categoryGroup][bu] = (sectionTotals[row.categoryGroup][bu] || 0) + amount;
      }
    }

    // Calculate grand totals per BU
    const grandTotals: Record<string, number> = {};
    for (const row of rows) {
      for (const [bu, amount] of Object.entries(row.amounts)) {
        grandTotals[bu] = (grandTotals[bu] || 0) + amount;
      }
    }

    return apiResponse.success(res, {
      dateRange: { from, to },
      businessUnits,
      rows,
      sectionTotals,
      grandTotals,
    });
  } catch (error) {
    logger.error('P&L by BU report failed', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

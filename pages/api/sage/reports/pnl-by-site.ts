/**
 * P&L by Site Report API
 *
 * GET - Returns P&L with columns per site (with FF project name),
 *       filterable by date range.
 *
 * Query params: fromDate, toDate (YYYY-MM-DD)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';

const logger = createLogger('api:sage:reports:pnl-by-site');

function getCategoryGroup(category: string): string {
  const lower = (category || '').toLowerCase();
  if (lower.includes('revenue') || lower.includes('income') || lower.includes('sales')) {
    if (lower.includes('cost')) return 'Cost of Sales';
    if (lower.includes('other')) return 'Other Income';
    return 'Revenue';
  }
  if (lower.includes('cost of sales') || lower === 'cos') return 'Cost of Sales';
  if (lower.includes('expense')) return 'Expenses';
  return 'Other';
}

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

    // Get site list with project names
    const siteList = await sql`
      SELECT DISTINCT
        sac.description as site_name,
        p.project_name,
        slt.sage_site_category_id
      FROM sage_ledger_transactions slt
      LEFT JOIN sage_analysis_categories sac
        ON sac.sage_category_id = slt.sage_site_category_id
      LEFT JOIN projects p ON p.id = slt.ff_project_id
      WHERE slt.sage_site_category_id IS NOT NULL
        AND slt.transaction_date >= ${from}
        AND slt.transaction_date <= ${to}
      ORDER BY sac.description
    `;

    const sites = siteList.map(s => ({
      id: s.sage_site_category_id as string,
      siteName: (s.site_name as string) || 'Unknown',
      projectName: (s.project_name as string) || null,
    }));

    // Get data from the view
    const data = await sql`
      SELECT
        sa.category_description,
        sa.reporting_group_description,
        sa.name as account_name,
        sa.sage_account_id,
        sac.description as site_name,
        slt.sage_site_category_id,
        p.project_name,
        SUM(slt.credit - slt.debit) as net_amount
      FROM sage_ledger_transactions slt
      LEFT JOIN sage_accounts sa ON sa.sage_account_id = slt.sage_account_id
      LEFT JOIN sage_analysis_categories sac
        ON sac.sage_category_id = slt.sage_site_category_id
      LEFT JOIN projects p ON p.id = slt.ff_project_id
      WHERE slt.transaction_date >= ${from}
        AND slt.transaction_date <= ${to}
      GROUP BY
        sa.category_description,
        sa.reporting_group_description,
        sa.name,
        sa.sage_account_id,
        sac.description,
        slt.sage_site_category_id,
        p.project_name
      ORDER BY sa.category_description, sa.name
    `;

    // Structure into P&L format (site columns)
    interface PnLRow {
      accountName: string;
      accountId: string;
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
      const siteKey = (row.site_name as string) || 'Unallocated';
      const netAmount = parseFloat(row.net_amount as string || '0');

      let pnlRow = rowMap.get(accountId);
      if (!pnlRow) {
        pnlRow = {
          accountName,
          accountId,
          categoryGroup: getCategoryGroup(category),
          amounts: {},
          total: 0,
        };
        rowMap.set(accountId, pnlRow);
        rows.push(pnlRow);
      }

      pnlRow.amounts[siteKey] = (pnlRow.amounts[siteKey] || 0) + netAmount;
      pnlRow.total += netAmount;
    }

    return apiResponse.success(res, {
      dateRange: { from, to },
      sites,
      rows,
    });
  } catch (error) {
    logger.error('P&L by Site report failed', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

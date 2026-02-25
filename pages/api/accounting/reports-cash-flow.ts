/**
 * Cash Flow Statement API
 * GET /api/accounting/reports-cash-flow?start_date=&end_date=
 * Sage equivalent: Reports > Cash Flow Statement
 *
 * Derives cash flow from GL journal lines using account subtypes:
 * - Operating: revenue, expense, receivable, payable changes
 * - Investing: asset account changes (non-cash)
 * - Financing: equity and loan changes
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const sql = createLoggedSql(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { start_date, end_date } = req.query;

    const startDate = (start_date as string) || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const endDate = (end_date as string) || new Date().toISOString().split('T')[0];

    // Get opening cash balance (bank accounts at start_date)
    const [openingCash] = await sql`
      SELECT COALESCE(SUM(
        CASE WHEN ga.normal_balance = 'debit' THEN jl.debit - jl.credit ELSE jl.credit - jl.debit END
      ), 0)::numeric as balance
      FROM gl_journal_lines jl
      JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
      JOIN gl_accounts ga ON ga.id = jl.account_id
      WHERE ga.account_subtype = 'bank'
        AND je.status = 'posted'
        AND je.entry_date < ${startDate}
    `;

    // Operating Activities: Net Income + changes in working capital
    const [netIncome] = await sql`
      SELECT
        COALESCE(SUM(CASE WHEN ga.account_type = 'revenue' THEN jl.credit - jl.debit ELSE 0 END), 0)::numeric
        - COALESCE(SUM(CASE WHEN ga.account_type = 'expense' THEN jl.debit - jl.credit ELSE 0 END), 0)::numeric
        as net_income
      FROM gl_journal_lines jl
      JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
      JOIN gl_accounts ga ON ga.id = jl.account_id
      WHERE je.status = 'posted'
        AND je.entry_date >= ${startDate}
        AND je.entry_date <= ${endDate}
        AND ga.account_type IN ('revenue', 'expense')
    `;

    // Changes in AR (receivable)
    const [arChange] = await sql`
      SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::numeric as change
      FROM gl_journal_lines jl
      JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
      JOIN gl_accounts ga ON ga.id = jl.account_id
      WHERE ga.account_subtype = 'receivable'
        AND je.status = 'posted'
        AND je.entry_date >= ${startDate}
        AND je.entry_date <= ${endDate}
    `;

    // Changes in AP (payable)
    const [apChange] = await sql`
      SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::numeric as change
      FROM gl_journal_lines jl
      JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
      JOIN gl_accounts ga ON ga.id = jl.account_id
      WHERE ga.account_subtype = 'payable'
        AND je.status = 'posted'
        AND je.entry_date >= ${startDate}
        AND je.entry_date <= ${endDate}
    `;

    // Investing: fixed asset changes
    const [investingChange] = await sql`
      SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::numeric as change
      FROM gl_journal_lines jl
      JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
      JOIN gl_accounts ga ON ga.id = jl.account_id
      WHERE ga.account_subtype IN ('fixed_asset', 'other_asset')
        AND je.status = 'posted'
        AND je.entry_date >= ${startDate}
        AND je.entry_date <= ${endDate}
    `;

    // Financing: equity + loan changes
    const [financingChange] = await sql`
      SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::numeric as change
      FROM gl_journal_lines jl
      JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
      JOIN gl_accounts ga ON ga.id = jl.account_id
      WHERE ga.account_type IN ('equity')
        AND ga.account_subtype NOT IN ('retained_earnings')
        AND je.status = 'posted'
        AND je.entry_date >= ${startDate}
        AND je.entry_date <= ${endDate}
    `;

    const operatingTotal = Number(netIncome.net_income) + Number(arChange.change) + Number(apChange.change);
    const investingTotal = Number(investingChange.change);
    const financingTotal = Number(financingChange.change);
    const netChange = operatingTotal + investingTotal + financingTotal;

    const report = {
      period_start: startDate,
      period_end: endDate,
      opening_cash: Number(openingCash.balance),
      sections: [
        {
          section: 'Operating Activities',
          items: [
            { label: 'Net Income', amount: Number(netIncome.net_income) },
            { label: 'Change in Accounts Receivable', amount: Number(arChange.change) },
            { label: 'Change in Accounts Payable', amount: Number(apChange.change) },
          ],
          total: operatingTotal,
        },
        {
          section: 'Investing Activities',
          items: [
            { label: 'Fixed Asset Changes', amount: Number(investingChange.change) },
          ],
          total: investingTotal,
        },
        {
          section: 'Financing Activities',
          items: [
            { label: 'Equity Changes', amount: Number(financingChange.change) },
          ],
          total: financingTotal,
        },
      ],
      net_change: netChange,
      closing_cash: Number(openingCash.balance) + netChange,
    };

    return apiResponse.success(res, { report });
  } catch (err) {
    log.error('Failed to generate cash flow statement', { error: err, module: 'accounting' });
    return apiResponse.databaseError(res, err, 'Failed to generate cash flow statement');
  }
}

export default withAuth(withErrorHandler(handler));

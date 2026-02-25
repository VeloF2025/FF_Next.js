/**
 * PRD-060: FibreFlow Accounting Module — Phase 5
 * Financial Reporting Service
 *
 * Income Statement, Balance Sheet, VAT Return, Project Profitability
 */

import { sql } from '@/lib/neon';
import { log } from '@/lib/logger';
import type {
  IncomeStatementReport,
  BalanceSheetReport,
  VATReturnReport,
  ProjectProfitabilityReport,
} from '../types/gl.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

interface ReportLineItem {
  accountCode: string;
  accountName: string;
  amount: number;
}

interface BalanceSheetLineItem {
  accountCode: string;
  accountName: string;
  balance: number;
}

// ── Income Statement (P&L) ───────────────────────────────────────────────────

export async function getIncomeStatement(
  periodStart: string,
  periodEnd: string,
  projectId?: string
): Promise<IncomeStatementReport> {
  try {
    let rows: Row[];

    if (projectId) {
      rows = (await sql`
        SELECT ga.account_code, ga.account_name, ga.account_type, ga.account_subtype,
          COALESCE(SUM(jl.debit), 0) AS total_debit,
          COALESCE(SUM(jl.credit), 0) AS total_credit
        FROM gl_journal_lines jl
        JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
        JOIN gl_accounts ga ON ga.id = jl.gl_account_id
        WHERE je.status = 'posted'
          AND je.entry_date >= ${periodStart}
          AND je.entry_date <= ${periodEnd}
          AND ga.account_type IN ('revenue', 'expense')
          AND jl.project_id = ${projectId}::UUID
        GROUP BY ga.id, ga.account_code, ga.account_name, ga.account_type, ga.account_subtype
        ORDER BY ga.account_code
      `) as Row[];
    } else {
      rows = (await sql`
        SELECT ga.account_code, ga.account_name, ga.account_type, ga.account_subtype,
          COALESCE(SUM(jl.debit), 0) AS total_debit,
          COALESCE(SUM(jl.credit), 0) AS total_credit
        FROM gl_journal_lines jl
        JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
        JOIN gl_accounts ga ON ga.id = jl.gl_account_id
        WHERE je.status = 'posted'
          AND je.entry_date >= ${periodStart}
          AND je.entry_date <= ${periodEnd}
          AND ga.account_type IN ('revenue', 'expense')
        GROUP BY ga.id, ga.account_code, ga.account_name, ga.account_type, ga.account_subtype
        ORDER BY ga.account_code
      `) as Row[];
    }

    const revenue: ReportLineItem[] = [];
    const costOfSales: ReportLineItem[] = [];
    const operatingExpenses: ReportLineItem[] = [];

    for (const r of rows) {
      const type = String(r.account_type);
      const subtype = r.account_subtype ? String(r.account_subtype) : '';
      const debit = Number(r.total_debit);
      const credit = Number(r.total_credit);

      if (type === 'revenue') {
        // Revenue: credit - debit (revenue normal balance is credit)
        const amount = credit - debit;
        if (Math.abs(amount) > 0.001) {
          revenue.push({ accountCode: String(r.account_code), accountName: String(r.account_name), amount });
        }
      } else if (type === 'expense') {
        // Expense: debit - credit (expense normal balance is debit)
        const amount = debit - credit;
        if (Math.abs(amount) > 0.001) {
          const item = { accountCode: String(r.account_code), accountName: String(r.account_name), amount };
          if (subtype === 'cost_of_sales') {
            costOfSales.push(item);
          } else {
            operatingExpenses.push(item);
          }
        }
      }
    }

    const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);
    const totalCostOfSales = costOfSales.reduce((s, r) => s + r.amount, 0);
    const grossProfit = totalRevenue - totalCostOfSales;
    const totalOperatingExpenses = operatingExpenses.reduce((s, r) => s + r.amount, 0);
    const netProfit = grossProfit - totalOperatingExpenses;

    return {
      periodStart,
      periodEnd,
      projectId,
      revenue,
      costOfSales,
      operatingExpenses,
      totalRevenue,
      totalCostOfSales,
      grossProfit,
      totalOperatingExpenses,
      netProfit,
    };
  } catch (err) {
    log.error('Failed to generate income statement', { error: err }, 'accounting');
    throw err;
  }
}

// ── Balance Sheet ────────────────────────────────────────────────────────────

export async function getBalanceSheet(asAtDate: string): Promise<BalanceSheetReport> {
  try {
    const rows = (await sql`
      SELECT ga.account_code, ga.account_name, ga.account_type, ga.normal_balance,
        COALESCE(SUM(jl.debit), 0) AS total_debit,
        COALESCE(SUM(jl.credit), 0) AS total_credit
      FROM gl_journal_lines jl
      JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
      JOIN gl_accounts ga ON ga.id = jl.gl_account_id
      WHERE je.status = 'posted'
        AND je.entry_date <= ${asAtDate}
        AND ga.account_type IN ('asset', 'liability', 'equity')
        AND ga.level >= 3
      GROUP BY ga.id, ga.account_code, ga.account_name, ga.account_type, ga.normal_balance
      ORDER BY ga.account_code
    `) as Row[];

    const assets: BalanceSheetLineItem[] = [];
    const liabilities: BalanceSheetLineItem[] = [];
    const equity: BalanceSheetLineItem[] = [];

    for (const r of rows) {
      const type = String(r.account_type);
      const normalBal = String(r.normal_balance);
      const debit = Number(r.total_debit);
      const credit = Number(r.total_credit);

      // Balance = debit - credit for debit-normal, credit - debit for credit-normal
      const balance = normalBal === 'debit' ? debit - credit : credit - debit;
      if (Math.abs(balance) < 0.01) continue;

      const item = { accountCode: String(r.account_code), accountName: String(r.account_name), balance };

      if (type === 'asset') assets.push(item);
      else if (type === 'liability') liabilities.push(item);
      else if (type === 'equity') equity.push(item);
    }

    // Add retained earnings (net of revenue - expenses to date)
    const retainedEarnings = await calculateRetainedEarnings(asAtDate);
    if (Math.abs(retainedEarnings) > 0.01) {
      const existing = equity.find(e => e.accountCode === '3200');
      if (existing) {
        existing.balance += retainedEarnings;
      } else {
        equity.push({ accountCode: '3200', accountName: 'Retained Earnings (Current)', balance: retainedEarnings });
      }
    }

    return {
      asAtDate,
      assets,
      liabilities,
      equity,
      totalAssets: assets.reduce((s, a) => s + a.balance, 0),
      totalLiabilities: liabilities.reduce((s, l) => s + l.balance, 0),
      totalEquity: equity.reduce((s, e) => s + e.balance, 0),
    };
  } catch (err) {
    log.error('Failed to generate balance sheet', { error: err }, 'accounting');
    throw err;
  }
}

async function calculateRetainedEarnings(asAtDate: string): Promise<number> {
  const rows = (await sql`
    SELECT
      COALESCE(SUM(CASE WHEN ga.account_type = 'revenue' THEN jl.credit - jl.debit ELSE 0 END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN ga.account_type = 'expense' THEN jl.debit - jl.credit ELSE 0 END), 0) AS expenses
    FROM gl_journal_lines jl
    JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
    JOIN gl_accounts ga ON ga.id = jl.gl_account_id
    WHERE je.status = 'posted'
      AND je.entry_date <= ${asAtDate}
      AND ga.account_type IN ('revenue', 'expense')
  `) as Row[];

  return Number(rows[0]!.revenue) - Number(rows[0]!.expenses);
}

// ── VAT Return ───────────────────────────────────────────────────────────────

export async function getVATReturn(
  periodStart: string,
  periodEnd: string
): Promise<VATReturnReport> {
  try {
    // Output VAT (2120) — credits to this account
    const outputRows = (await sql`
      SELECT ga.account_code, ga.account_name,
        COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0) AS amount
      FROM gl_journal_lines jl
      JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
      JOIN gl_accounts ga ON ga.id = jl.gl_account_id
      WHERE je.status = 'posted'
        AND je.entry_date >= ${periodStart}
        AND je.entry_date <= ${periodEnd}
        AND ga.account_subtype = 'tax'
        AND ga.account_type = 'liability'
      GROUP BY ga.id, ga.account_code, ga.account_name
      ORDER BY ga.account_code
    `) as Row[];

    // Input VAT (1140) — debits to this account
    const inputRows = (await sql`
      SELECT ga.account_code, ga.account_name,
        COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) AS amount
      FROM gl_journal_lines jl
      JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
      JOIN gl_accounts ga ON ga.id = jl.gl_account_id
      WHERE je.status = 'posted'
        AND je.entry_date >= ${periodStart}
        AND je.entry_date <= ${periodEnd}
        AND (ga.account_code = '1140' OR ga.account_subtype = 'tax' AND ga.account_type = 'asset')
      GROUP BY ga.id, ga.account_code, ga.account_name
      ORDER BY ga.account_code
    `) as Row[];

    const outputDetails = outputRows.map((r: Row) => ({
      accountCode: String(r.account_code),
      accountName: String(r.account_name),
      amount: Number(r.amount),
    }));
    const inputDetails = inputRows.map((r: Row) => ({
      accountCode: String(r.account_code),
      accountName: String(r.account_name),
      amount: Number(r.amount),
    }));

    const outputVAT = outputDetails.reduce((s, d) => s + d.amount, 0);
    const inputVAT = inputDetails.reduce((s, d) => s + d.amount, 0);

    return {
      periodStart,
      periodEnd,
      outputVAT,
      inputVAT,
      netVAT: outputVAT - inputVAT,
      outputDetails,
      inputDetails,
    };
  } catch (err) {
    log.error('Failed to generate VAT return', { error: err }, 'accounting');
    throw err;
  }
}

// ── Project Profitability ────────────────────────────────────────────────────

export async function getProjectProfitability(
  periodStart: string,
  periodEnd: string
): Promise<ProjectProfitabilityReport[]> {
  try {
    // Get all projects with journal activity in the period
    const projectRows = (await sql`
      SELECT DISTINCT jl.project_id, p.project_name
      FROM gl_journal_lines jl
      JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
      LEFT JOIN projects p ON p.id = jl.project_id
      WHERE je.status = 'posted'
        AND je.entry_date >= ${periodStart}
        AND je.entry_date <= ${periodEnd}
        AND jl.project_id IS NOT NULL
      ORDER BY p.project_name
    `) as Row[];

    const reports: ProjectProfitabilityReport[] = [];

    for (const proj of projectRows) {
      const projectId = String(proj.project_id);
      const projectName = proj.project_name ? String(proj.project_name) : 'Unknown Project';

      const rows = (await sql`
        SELECT ga.account_code, ga.account_name, ga.account_type,
          COALESCE(SUM(jl.debit), 0) AS total_debit,
          COALESCE(SUM(jl.credit), 0) AS total_credit
        FROM gl_journal_lines jl
        JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
        JOIN gl_accounts ga ON ga.id = jl.gl_account_id
        WHERE je.status = 'posted'
          AND je.entry_date >= ${periodStart}
          AND je.entry_date <= ${periodEnd}
          AND jl.project_id = ${projectId}::UUID
          AND ga.account_type IN ('revenue', 'expense')
        GROUP BY ga.id, ga.account_code, ga.account_name, ga.account_type
        ORDER BY ga.account_code
      `) as Row[];

      const revenueLines: ReportLineItem[] = [];
      const costLines: ReportLineItem[] = [];

      for (const r of rows) {
        const type = String(r.account_type);
        const debit = Number(r.total_debit);
        const credit = Number(r.total_credit);

        if (type === 'revenue') {
          const amount = credit - debit;
          if (Math.abs(amount) > 0.001) {
            revenueLines.push({ accountCode: String(r.account_code), accountName: String(r.account_name), amount });
          }
        } else if (type === 'expense') {
          const amount = debit - credit;
          if (Math.abs(amount) > 0.001) {
            costLines.push({ accountCode: String(r.account_code), accountName: String(r.account_name), amount });
          }
        }
      }

      const revenue = revenueLines.reduce((s, r) => s + r.amount, 0);
      const costs = costLines.reduce((s, c) => s + c.amount, 0);
      const profit = revenue - costs;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

      reports.push({
        projectId,
        projectName,
        periodStart,
        periodEnd,
        revenue,
        costs,
        profit,
        margin: Math.round(margin * 100) / 100,
        revenueLines,
        costLines,
      });
    }

    // Sort by profit DESC
    reports.sort((a, b) => b.profit - a.profit);
    return reports;
  } catch (err) {
    log.error('Failed to generate project profitability', { error: err }, 'accounting');
    throw err;
  }
}

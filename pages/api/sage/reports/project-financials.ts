/**
 * Project Financial Summary API
 *
 * GET - Combined FF budget + Sage actuals for a project.
 *       Shows Budget, Committed (POs), Sage Actuals, Variance.
 *
 * Query params: projectId (required)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';

const logger = createLogger('api:sage:reports:project-financials');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const sql = neon(process.env.DATABASE_URL!);
  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'projectId is required');
  }

  try {
    // Get project info
    const project = await sql`
      SELECT id, project_name as name, status FROM projects WHERE id = ${projectId}
    `;

    if (project.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    // Get FF budget
    const budget = await sql`
      SELECT
        total_budget,
        committed_amount,
        actual_amount,
        available_budget,
        status
      FROM project_budgets
      WHERE project_id = ${projectId}
    `;

    // Get committed from POs
    const poCommitted = await sql`
      SELECT
        COALESCE(SUM(total_amount), 0) as total,
        COUNT(*) as count,
        COUNT(*) FILTER (WHERE status = 'approved') as approved,
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE payment_status = 'paid') as paid
      FROM purchase_orders
      WHERE project_id = ${projectId}
        AND status NOT IN ('cancelled', 'draft')
    `;

    // Get Sage actuals from ledger transactions
    const sageActuals = await sql`
      SELECT
        sa.category_description,
        SUM(slt.debit) as total_debit,
        SUM(slt.credit) as total_credit,
        SUM(slt.debit - slt.credit) as net_amount,
        COUNT(*) as transaction_count
      FROM sage_ledger_transactions slt
      LEFT JOIN sage_accounts sa ON sa.sage_account_id = slt.sage_account_id
      WHERE slt.ff_project_id = ${projectId}
      GROUP BY sa.category_description
      ORDER BY sa.category_description
    `;

    // Get Sage actuals by BU for this project
    const actualsByBU = await sql`
      SELECT
        COALESCE(ff_business_unit, 'Unallocated') as business_unit,
        SUM(debit) as total_debit,
        SUM(credit) as total_credit,
        SUM(debit - credit) as net_amount,
        COUNT(*) as transaction_count
      FROM sage_ledger_transactions
      WHERE ff_project_id = ${projectId}
      GROUP BY ff_business_unit
      ORDER BY ff_business_unit
    `;

    // Get Sage invoice + payment data
    const invoiceData = await sql`
      SELECT
        COALESCE(SUM(ssi.total_amount), 0) as invoiced,
        COALESCE(SUM(ssi.outstanding_amount), 0) as outstanding,
        COUNT(*) as invoice_count
      FROM sage_supplier_invoices ssi
      JOIN purchase_orders po ON po.id = ssi.ff_purchase_order_id
      WHERE po.project_id = ${projectId}
    `;

    // Monthly trend
    const monthlyTrend = await sql`
      SELECT
        DATE_TRUNC('month', transaction_date) as month,
        SUM(debit) as total_debit,
        SUM(credit) as total_credit,
        SUM(debit - credit) as net_amount
      FROM sage_ledger_transactions
      WHERE ff_project_id = ${projectId}
      GROUP BY DATE_TRUNC('month', transaction_date)
      ORDER BY month
    `;

    // Calculate totals
    const totalBudget = parseFloat(budget[0]?.total_budget as string || '0');
    const totalCommitted = parseFloat(poCommitted[0]?.total as string || '0');
    const totalSageActuals = sageActuals.reduce(
      (sum, row) => sum + parseFloat(row.net_amount as string || '0'), 0
    );
    const totalInvoiced = parseFloat(invoiceData[0]?.invoiced as string || '0');

    return apiResponse.success(res, {
      project: project[0],
      summary: {
        budget: totalBudget,
        committed: totalCommitted,
        sageActuals: totalSageActuals,
        invoiced: totalInvoiced,
        outstanding: parseFloat(invoiceData[0]?.outstanding as string || '0'),
        variance: totalBudget - totalSageActuals,
        variancePercent: totalBudget > 0
          ? ((totalBudget - totalSageActuals) / totalBudget) * 100
          : 0,
        budgetStatus: budget[0]?.status || 'none',
      },
      purchaseOrders: {
        total: parseInt(poCommitted[0]?.count as string || '0'),
        approved: parseInt(poCommitted[0]?.approved as string || '0'),
        sent: parseInt(poCommitted[0]?.sent as string || '0'),
        paid: parseInt(poCommitted[0]?.paid as string || '0'),
        totalAmount: totalCommitted,
      },
      sageBreakdown: sageActuals.map(row => ({
        category: row.category_description as string,
        debit: parseFloat(row.total_debit as string || '0'),
        credit: parseFloat(row.total_credit as string || '0'),
        netAmount: parseFloat(row.net_amount as string || '0'),
        transactionCount: parseInt(row.transaction_count as string || '0'),
      })),
      byBusinessUnit: actualsByBU.map(row => ({
        businessUnit: row.business_unit as string,
        debit: parseFloat(row.total_debit as string || '0'),
        credit: parseFloat(row.total_credit as string || '0'),
        netAmount: parseFloat(row.net_amount as string || '0'),
        transactionCount: parseInt(row.transaction_count as string || '0'),
      })),
      monthlyTrend: monthlyTrend.map(row => ({
        month: row.month as string,
        debit: parseFloat(row.total_debit as string || '0'),
        credit: parseFloat(row.total_credit as string || '0'),
        netAmount: parseFloat(row.net_amount as string || '0'),
      })),
    });
  } catch (error) {
    logger.error('Project financials report failed', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

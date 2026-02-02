/**
 * Finance Dashboard API
 * GET /api/projects/[projectId]/finance/dashboard - Aggregated financial dashboard data
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { FinanceDashboardData, RecentTransaction } from '@/types/finance';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const projectId = req.query.projectId as string;

  if (!projectId) {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    // Get Client PO summary (income side)
    const clientPOsResult = await sql`
      SELECT
        COALESCE(SUM(total_value), 0) as total_contract_value,
        COALESCE(SUM(contracted_drops), 0) as total_drops_contracted,
        COALESCE(SUM(drops_activated), 0) as total_drops_activated,
        COALESCE(SUM(amount_invoiced), 0) as total_invoiced,
        COALESCE(SUM(amount_paid), 0) as total_paid,
        COUNT(*) as po_count,
        COUNT(*) FILTER (WHERE status = 'active') as active_po_count
      FROM client_purchase_orders
      WHERE project_id = ${projectId}
        AND status != 'cancelled'
    `;

    const clientPOs = clientPOsResult[0];
    const clientPOSummary = {
      totalContractValue: Number(clientPOs?.total_contract_value || 0),
      totalDropsContracted: Number(clientPOs?.total_drops_contracted || 0),
      totalDropsActivated: Number(clientPOs?.total_drops_activated || 0),
      totalInvoiced: Number(clientPOs?.total_invoiced || 0),
      totalPaid: Number(clientPOs?.total_paid || 0),
      totalOutstanding: Number(clientPOs?.total_invoiced || 0) - Number(clientPOs?.total_paid || 0),
      activationProgress: Number(clientPOs?.total_drops_contracted) > 0
        ? Math.round((Number(clientPOs?.total_drops_activated) / Number(clientPOs?.total_drops_contracted)) * 100 * 100) / 100
        : 0,
      invoicingProgress: Number(clientPOs?.total_contract_value) > 0
        ? Math.round((Number(clientPOs?.total_invoiced) / Number(clientPOs?.total_contract_value)) * 100 * 100) / 100
        : 0,
      poCount: Number(clientPOs?.po_count || 0),
      activePoCount: Number(clientPOs?.active_po_count || 0),
    };

    // Get Budget summary (expense control)
    const budgetResult = await sql`
      SELECT
        total_budget,
        committed_amount,
        actual_amount,
        available_budget
      FROM project_budgets
      WHERE project_id = ${projectId}
    `;

    let budgetSummary = null;
    if (budgetResult.length > 0 && budgetResult[0]) {
      const budget = budgetResult[0];
      const totalBudget = Number(budget.total_budget);
      const committedAmount = Number(budget.committed_amount);
      const actualAmount = Number(budget.actual_amount);
      const utilizationPercent = totalBudget > 0
        ? Math.round((committedAmount / totalBudget) * 100 * 100) / 100
        : 0;

      budgetSummary = {
        totalBudget,
        committedAmount,
        actualAmount,
        availableBudget: Number(budget.available_budget),
        utilizationPercent,
        health: utilizationPercent >= 100 ? 'critical' as const
          : utilizationPercent >= 80 ? 'warning' as const
          : 'healthy' as const,
      };
    }

    // Get Procurement summary (supplier POs)
    const procurementResult = await sql`
      SELECT
        COALESCE(SUM(total_amount), 0) as total_po_value,
        COUNT(*) as po_count,
        COUNT(*) FILTER (WHERE status = 'pending_approval') as pending_approval_count
      FROM purchase_orders
      WHERE project_id = ${projectId}
        AND status != 'cancelled'
    `;

    // Get vendor invoices total
    const vendorInvoicesResult = await sql`
      SELECT
        COALESCE(SUM(vi.amount_total), 0) as total_invoiced,
        COALESCE(SUM(vi.amount_paid), 0) as total_paid
      FROM vendor_invoices vi
      INNER JOIN purchase_orders po ON po.id = vi.purchase_order_id
      WHERE po.project_id = ${projectId}
    `;

    const procurementSummary = {
      totalPOValue: Number(procurementResult[0]?.total_po_value || 0),
      totalInvoiced: Number(vendorInvoicesResult[0]?.total_invoiced || 0),
      totalPaid: Number(vendorInvoicesResult[0]?.total_paid || 0),
      poCount: Number(procurementResult[0]?.po_count || 0),
      pendingApprovalCount: Number(procurementResult[0]?.pending_approval_count || 0),
    };

    // Get Customer Invoice summary
    const invoiceSummary = await sql`
      SELECT
        COALESCE(SUM(total_amount), 0) as total_invoiced,
        COALESCE(SUM(amount_paid), 0) as total_paid,
        COUNT(*) as invoice_count,
        COUNT(*) FILTER (WHERE status = 'draft') as draft_count,
        COUNT(*) FILTER (WHERE status = 'pending_approval') as pending_approval_count,
        COUNT(*) FILTER (WHERE status = 'sent') as sent_count,
        COUNT(*) FILTER (WHERE status = 'overdue') as overdue_count
      FROM customer_invoices
      WHERE project_id = ${projectId}
    `;

    const invoiceSummaryData = {
      totalInvoiced: Number(invoiceSummary[0]?.total_invoiced || 0),
      totalPaid: Number(invoiceSummary[0]?.total_paid || 0),
      totalOutstanding: Number(invoiceSummary[0]?.total_invoiced || 0) - Number(invoiceSummary[0]?.total_paid || 0),
      invoiceCount: Number(invoiceSummary[0]?.invoice_count || 0),
      draftCount: Number(invoiceSummary[0]?.draft_count || 0),
      pendingApprovalCount: Number(invoiceSummary[0]?.pending_approval_count || 0),
      sentCount: Number(invoiceSummary[0]?.sent_count || 0),
      overdueCount: Number(invoiceSummary[0]?.overdue_count || 0),
    };

    // Get this week's activity
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const weeklyActivity = await sql`
      SELECT
        (SELECT COUNT(*) FROM oes_activations oa
         INNER JOIN drops d ON d.id = oa.drop_id
         WHERE d.project_id = ${projectId}
         AND oa.activation_date >= ${weekStartStr}) as activations,
        (SELECT COUNT(*) FROM customer_invoices
         WHERE project_id = ${projectId}
         AND created_at >= ${weekStartStr}) as invoices_generated,
        (SELECT COALESCE(SUM(amount_paid), 0) FROM customer_invoices
         WHERE project_id = ${projectId}
         AND paid_at >= ${weekStartStr}) as payments_received
    `;

    const thisWeek = {
      activations: Number(weeklyActivity[0]?.activations || 0),
      invoicesGenerated: Number(weeklyActivity[0]?.invoices_generated || 0),
      paymentsReceived: Number(weeklyActivity[0]?.payments_received || 0),
    };

    // Calculate net position
    const totalIncome = clientPOSummary.totalInvoiced;
    const totalExpenses = budgetSummary?.actualAmount || 0;
    const margin = totalIncome - totalExpenses;
    const marginPercent = totalIncome > 0
      ? Math.round((margin / totalIncome) * 100 * 100) / 100
      : 0;

    const netPosition = {
      totalIncome,
      totalExpenses,
      margin,
      marginPercent,
    };

    // Get recent transactions
    const recentTransactions = await getRecentTransactions(projectId);

    const dashboardData: FinanceDashboardData = {
      clientPOs: clientPOSummary,
      budget: budgetSummary,
      procurement: procurementSummary,
      invoices: invoiceSummaryData,
      thisWeek,
      netPosition,
      recentTransactions,
    };

    return apiResponse.success(res, dashboardData);
  } catch (error) {
    log.error('Failed to fetch finance dashboard', { projectId, error });
    return apiResponse.databaseError(res, error, 'Failed to fetch finance dashboard');
  }
}));

async function getRecentTransactions(projectId: string): Promise<RecentTransaction[]> {
  const transactions: RecentTransaction[] = [];

  // Recent customer invoices
  const invoices = await sql`
    SELECT
      id, invoice_number, total_amount, status, created_at
    FROM customer_invoices
    WHERE project_id = ${projectId}
    ORDER BY created_at DESC
    LIMIT 5
  `;

  for (const inv of invoices) {
    transactions.push({
      id: inv.id,
      date: inv.created_at,
      type: inv.status === 'sent' ? 'invoice_sent' : 'invoice_created',
      description: `Invoice ${inv.invoice_number}`,
      amount: Number(inv.total_amount),
      reference: inv.invoice_number,
      sourceType: 'customer_invoice',
      sourceId: inv.id,
    });
  }

  // Recent supplier POs
  const supplierPOs = await sql`
    SELECT
      id, po_number, total_amount, created_at
    FROM purchase_orders
    WHERE project_id = ${projectId}
    AND status != 'cancelled'
    ORDER BY created_at DESC
    LIMIT 5
  `;

  for (const po of supplierPOs) {
    transactions.push({
      id: po.id,
      date: po.created_at,
      type: 'po_created',
      description: `Supplier PO ${po.po_number}`,
      amount: -Number(po.total_amount),
      reference: po.po_number,
      sourceType: 'purchase_order',
      sourceId: po.id,
    });
  }

  // Sort by date and return top 10
  return transactions
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 10);
}

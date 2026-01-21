/**
 * Procurement Budget Dashboard API
 * GET /api/procurement/budget/dashboard - Get aggregated budget overview
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    // Get aggregated totals
    const totals = await sql`
      SELECT
        COUNT(*) as project_count,
        COALESCE(SUM(total_budget), 0) as total_budget,
        COALESCE(SUM(committed_amount), 0) as total_committed,
        COALESCE(SUM(actual_amount), 0) as total_actual,
        COALESCE(SUM(available_budget), 0) as total_available
      FROM project_budgets
      WHERE status != 'closed'
    `;

    // Get health breakdown
    const healthBreakdown = await sql`
      SELECT
        CASE
          WHEN total_budget > 0 THEN
            CASE
              WHEN committed_amount / total_budget >= alert_threshold_critical / 100 THEN 'critical'
              WHEN committed_amount / total_budget >= alert_threshold_warning / 100 THEN 'warning'
              ELSE 'healthy'
            END
          ELSE 'healthy'
        END AS health,
        COUNT(*) as count,
        SUM(total_budget) as budget_sum
      FROM project_budgets
      WHERE status != 'closed'
      GROUP BY health
    `;

    // Get all project budgets with summary
    const projectBudgets = await sql`
      SELECT * FROM v_project_budgets_dashboard
      ORDER BY utilization_percent DESC
    `;

    // Get category totals across all budgets
    const categoryTotals = await sql`
      SELECT
        bc.category_code,
        bc.category_name,
        COUNT(DISTINCT bc.project_budget_id) as project_count,
        SUM(bc.allocated_amount) as total_allocated,
        SUM(bc.committed_amount) as total_committed,
        SUM(bc.actual_amount) as total_actual,
        SUM(bc.available_amount) as total_available
      FROM budget_categories bc
      JOIN project_budgets pb ON bc.project_budget_id = pb.id
      WHERE pb.status != 'closed'
      GROUP BY bc.category_code, bc.category_name
      ORDER BY SUM(bc.allocated_amount) DESC
    `;

    // Get recent transactions
    const recentTransactions = await sql`
      SELECT
        bt.*,
        pb.project_id,
        p.project_code,
        p.project_name
      FROM budget_transactions bt
      JOIN project_budgets pb ON bt.project_budget_id = pb.id
      LEFT JOIN projects p ON pb.project_id = p.id
      ORDER BY bt.created_at DESC
      LIMIT 20
    `;

    // Get active alerts
    const activeAlerts = await sql`
      SELECT
        ba.*,
        pb.project_id,
        p.project_code,
        p.project_name
      FROM budget_alerts ba
      JOIN project_budgets pb ON ba.project_budget_id = pb.id
      LEFT JOIN projects p ON pb.project_id = p.id
      WHERE ba.status = 'active'
      ORDER BY
        CASE ba.severity
          WHEN 'critical' THEN 1
          WHEN 'warning' THEN 2
          ELSE 3
        END,
        ba.created_at DESC
      LIMIT 10
    `;

    // Calculate utilization
    const totalsRow = totals[0] || {};
    const totalBudget = parseFloat(totalsRow.total_budget as string) || 0;
    const totalCommitted = parseFloat(totalsRow.total_committed as string) || 0;
    const utilizationPercent = totalBudget > 0
      ? Math.round((totalCommitted / totalBudget * 100) * 100) / 100
      : 0;

    return apiResponse.success(res, {
      summary: {
        projectCount: parseInt(totalsRow.project_count as string) || 0,
        totalBudget,
        totalCommitted,
        totalActual: parseFloat(totalsRow.total_actual as string) || 0,
        totalAvailable: parseFloat(totalsRow.total_available as string) || 0,
        utilizationPercent,
      },
      healthBreakdown: healthBreakdown.reduce((acc, h) => {
        acc[h.health as string] = {
          count: parseInt(h.count as string) || 0,
          budgetSum: parseFloat(h.budget_sum as string) || 0,
        };
        return acc;
      }, {} as Record<string, { count: number; budgetSum: number }>),
      projectBudgets,
      categoryTotals,
      recentTransactions,
      activeAlerts,
    });
  } catch (error) {
    log.error('Budget Dashboard API error', { error, module: 'procurement:budget' });
    return apiResponse.internalError(res, error);
  }
}

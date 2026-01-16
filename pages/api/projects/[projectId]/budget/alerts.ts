/**
 * API endpoint for budget alerts
 * PRD-057: Project Budget Tracking System
 *
 * GET /api/projects/[projectId]/budget/alerts - List alerts
 * POST /api/projects/[projectId]/budget/alerts/[id]/acknowledge - Acknowledge alert
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { BudgetAlert, AlertType, AlertSeverity, AlertStatus } from '@/types/budget';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { getAuth } from '@/lib/auth-mock';
import { log } from '@/lib/logger';

const sql = createLoggedSql(process.env.DATABASE_URL!);

const VALID_STATUSES: AlertStatus[] = ['active', 'acknowledged', 'resolved'];

export default withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const { userId } = getAuth(req);
  const projectId = req.query.projectId as string;
  const alertId = req.query.alertId as string | undefined;
  const action = req.query.action as string | undefined;

  if (!projectId) {
    return apiResponse.validationError(res, {
      projectId: 'Project ID is required',
    });
  }

  // GET - List alerts
  if (req.method === 'GET') {
    try {
      // Parse query params
      const status = req.query.status as AlertStatus | undefined;
      const severity = req.query.severity as AlertSeverity | undefined;
      const includeResolved = req.query.includeResolved === 'true';

      // Validate status if provided
      if (status && !VALID_STATUSES.includes(status)) {
        return apiResponse.validationError(res, {
          status: `Invalid status. Valid statuses: ${VALID_STATUSES.join(', ')}`,
        });
      }

      // Get budget for project
      const budgets = await sql`
        SELECT id FROM project_budgets WHERE project_id = ${projectId}
      `;

      if (budgets.length === 0) {
        return apiResponse.success(res, {
          alerts: [],
          summary: {
            active: 0,
            acknowledged: 0,
            resolved: 0,
          },
        });
      }

      const budget = budgets[0];
      if (!budget) {
        return apiResponse.success(res, {
          alerts: [],
          summary: { active: 0, acknowledged: 0, resolved: 0 },
        });
      }
      const budgetId = budget.id;

      // Get alerts
      const alerts = await sql`
        SELECT *
        FROM budget_alerts
        WHERE project_budget_id = ${budgetId}
        ${status ? sql`AND status = ${status}` : sql``}
        ${severity ? sql`AND severity = ${severity}` : sql``}
        ${!includeResolved && !status ? sql`AND status != 'resolved'` : sql``}
        ORDER BY
          CASE severity
            WHEN 'critical' THEN 1
            WHEN 'warning' THEN 2
            WHEN 'info' THEN 3
          END,
          created_at DESC
      `;

      // Get summary counts
      const summaryResult = await sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active') as active,
          COUNT(*) FILTER (WHERE status = 'acknowledged') as acknowledged,
          COUNT(*) FILTER (WHERE status = 'resolved') as resolved
        FROM budget_alerts
        WHERE project_budget_id = ${budgetId}
      `;

      const summary = summaryResult[0];
      return apiResponse.success(res, {
        alerts: alerts.map(transformAlert),
        summary: {
          active: parseInt(summary?.active ?? '0'),
          acknowledged: parseInt(summary?.acknowledged ?? '0'),
          resolved: parseInt(summary?.resolved ?? '0'),
        },
      });
    } catch (error) {
      log.error('Failed to fetch alerts', { projectId, error });
      return apiResponse.databaseError(res, error, 'Failed to fetch alerts');
    }
  }

  // POST - Acknowledge or resolve alert
  if (req.method === 'POST') {
    try {
      if (!alertId) {
        return apiResponse.validationError(res, {
          alertId: 'Alert ID is required',
        });
      }

      // Determine action from URL or body
      const alertAction = action || req.body.action;

      if (!alertAction || !['acknowledge', 'resolve'].includes(alertAction)) {
        return apiResponse.validationError(res, {
          action: 'Action must be acknowledge or resolve',
        });
      }

      // Get alert
      const alerts = await sql`
        SELECT ba.*, pb.project_id
        FROM budget_alerts ba
        JOIN project_budgets pb ON pb.id = ba.project_budget_id
        WHERE ba.id = ${alertId} AND pb.project_id = ${projectId}
      `;

      if (alerts.length === 0 || !alerts[0]) {
        return apiResponse.notFound(res, 'Alert', alertId);
      }

      const alert = alerts[0];
      const alertStatus = alert.status as string;

      // Check current status
      if (alertStatus === 'resolved') {
        return apiResponse.badRequest(res, 'Alert is already resolved');
      }

      if (alertAction === 'acknowledge' && alertStatus === 'acknowledged') {
        return apiResponse.badRequest(res, 'Alert is already acknowledged');
      }

      // Update alert
      const newStatus = alertAction === 'acknowledge' ? 'acknowledged' : 'resolved';

      const acknowledgedBy = alert.acknowledged_by as string | null;
      const acknowledgedAt = alert.acknowledged_at as string | null;

      const result = await sql`
        UPDATE budget_alerts
        SET
          status = ${newStatus},
          acknowledged_by = ${alertAction === 'acknowledge' ? userId : acknowledgedBy},
          acknowledged_at = ${alertAction === 'acknowledge' ? sql`NOW()` : acknowledgedAt ? sql`${acknowledgedAt}::timestamp` : sql`NULL`},
          resolved_by = ${alertAction === 'resolve' ? userId : null},
          resolved_at = ${alertAction === 'resolve' ? sql`NOW()` : null}
        WHERE id = ${alertId}
        RETURNING *
      `;

      const updated = result[0];
      log.info(`Alert ${alertAction}d`, {
        alertId,
        projectId,
        newStatus,
        userId,
      });

      return apiResponse.success(res, {
        alert: updated ? transformAlert(updated) : null,
        message: `Alert ${alertAction}d successfully`,
      });
    } catch (error) {
      log.error('Failed to update alert', { projectId, alertId, error });
      return apiResponse.databaseError(res, error, 'Failed to update alert');
    }
  }

  // Method not allowed
  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
});

/**
 * Transform database alert row to API response
 */
function transformAlert(row: Record<string, unknown>): Partial<BudgetAlert> {
  return {
    id: row.id as string,
    projectBudgetId: row.project_budget_id as string,
    alertType: row.alert_type as AlertType,
    severity: row.severity as AlertSeverity,
    thresholdPercent: row.threshold_percent ? Number(row.threshold_percent) : undefined,
    currentPercent: row.current_percent ? Number(row.current_percent) : undefined,
    amountInvolved: row.amount_involved ? Number(row.amount_involved) : undefined,
    title: row.title as string,
    message: row.message as string | undefined,
    status: row.status as AlertStatus,
    acknowledgedBy: row.acknowledged_by as string | undefined,
    acknowledgedAt: row.acknowledged_at as string | undefined,
    resolvedBy: row.resolved_by as string | undefined,
    resolvedAt: row.resolved_at as string | undefined,
    createdAt: row.created_at as string,
  };
}

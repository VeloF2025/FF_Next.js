/**
 * API endpoint for individual budget alert actions
 * PRD-057: Project Budget Tracking System
 *
 * GET /api/projects/[projectId]/budget/alerts/[alertId] - Get alert details
 * POST /api/projects/[projectId]/budget/alerts/[alertId] - Acknowledge or resolve alert
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { BudgetAlert, AlertType, AlertSeverity, AlertStatus } from '@/types/budget';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
    const userId = (req as AuthenticatedNextApiRequest).user.id;
  const projectId = req.query.projectId as string;
  const alertId = req.query.alertId as string;

  if (!projectId) {
    return apiResponse.validationError(res, {
      projectId: 'Project ID is required',
    });
  }

  if (!alertId) {
    return apiResponse.validationError(res, {
      alertId: 'Alert ID is required',
    });
  }

  // Get alert with project verification
  const alertsResult = await sql`
    SELECT ba.*, pb.project_id
    FROM budget_alerts ba
    JOIN project_budgets pb ON pb.id = ba.project_budget_id
    WHERE ba.id = ${alertId} AND pb.project_id = ${projectId}
  `;

  if (alertsResult.length === 0 || !alertsResult[0]) {
    return apiResponse.notFound(res, 'Alert', alertId);
  }

  const alert = alertsResult[0];
  const alertStatus = alert.status as string;

  // GET - Get alert details
  if (req.method === 'GET') {
    return apiResponse.success(res, {
      alert: transformAlert(alert),
    });
  }

  // POST - Acknowledge or resolve alert
  if (req.method === 'POST') {
    try {
      // Determine action from URL path or body
      const urlParts = req.url?.split('/') || [];
      let action = urlParts[urlParts.length - 1] || '';

      // If alertId is last, check body for action
      if (action === alertId || !['acknowledge', 'resolve'].includes(action)) {
        action = req.body.action || '';
      }

      if (!action || !['acknowledge', 'resolve'].includes(action)) {
        return apiResponse.validationError(res, {
          action: 'Action must be acknowledge or resolve',
        });
      }

      // Check current status
      if (alertStatus === 'resolved') {
        return apiResponse.badRequest(res, 'Alert is already resolved');
      }

      if (action === 'acknowledge' && alertStatus === 'acknowledged') {
        return apiResponse.badRequest(res, 'Alert is already acknowledged');
      }

      // Update alert
      const newStatus = action === 'acknowledge' ? 'acknowledged' : 'resolved';
      const acknowledgedBy = alert.acknowledged_by as string | null;
      const acknowledgedAt = alert.acknowledged_at as string | null;

      const result = await sql`
        UPDATE budget_alerts
        SET
          status = ${newStatus},
          acknowledged_by = ${action === 'acknowledge' ? userId : acknowledgedBy},
          acknowledged_at = ${action === 'acknowledge' ? sql`NOW()` : acknowledgedAt ? sql`${acknowledgedAt}::timestamp` : sql`NULL`},
          resolved_by = ${action === 'resolve' ? userId : null},
          resolved_at = ${action === 'resolve' ? sql`NOW()` : null}
        WHERE id = ${alertId}
        RETURNING *
      `;

      const updated = result[0];
      log.info(`Alert ${action}d`, {
        alertId,
        projectId,
        newStatus,
        userId,
      });

      return apiResponse.success(res, {
        alert: updated ? transformAlert(updated) : null,
        message: `Alert ${action}d successfully`,
      });
    } catch (error) {
      log.error('Failed to update alert', { projectId, alertId, error });
      return apiResponse.databaseError(res, error, 'Failed to update alert');
    }
  }

  // Method not allowed
  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}));

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

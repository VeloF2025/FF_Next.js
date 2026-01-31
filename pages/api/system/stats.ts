/**
 * System Statistics API
 *
 * GET /api/system/stats - Get system statistics and recovery history
 *
 * NOTE: Works with the Python AI Recovery Agent on Velocity server.
 * All stats are read directly from the database.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withRole } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withErrorHandler } from '@/lib/api-error-handler';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const module = await import('@/lib/db');
  const db = module.db || module.default;
  if (!db) {
    return apiResponse.error(res, ErrorCode.DATABASE_ERROR, 'Database not available');
  }

  const { includeHistory } = req.query;

  try {
    // All 9 queries are independent - run in parallel
    const [
      overallResult,
      mttrResult,
      pendingResult,
      activeResult,
      daemonResult,
      todayStats,
      commonFailuresResult,
      improvingResult,
      decliningResult,
    ] = await Promise.all([
      // Overall success rate from recovery_actions
      db.query(`
        SELECT
          SUM(success_count) as total_success,
          SUM(failure_count) as total_failure
        FROM recovery_actions
      `),
      // MTTR from resolved incidents
      db.query(`
        SELECT
          AVG(time_to_resolve_seconds) as avg_seconds,
          COUNT(*) as incident_count
        FROM infrastructure_incidents
        WHERE resolved = true AND time_to_resolve_seconds IS NOT NULL
      `),
      // Pending approvals count
      db.query(`SELECT COUNT(*) as count FROM recovery_approval_queue WHERE status = 'pending'`),
      // Active incidents count
      db.query(`SELECT COUNT(*) as count FROM infrastructure_incidents WHERE resolved = false`),
      // Daemon status from recent health logs
      db.query(`
        SELECT timestamp as last_check, created_at
        FROM system_health_logs
        ORDER BY created_at DESC
        LIMIT 1
      `),
      // Today's stats (internally uses Promise.all for 3 queries)
      getTodayStats(db),
      // Common failures
      db.query(`
        SELECT
          a.action_name,
          a.failure_count,
          s.name as service_name
        FROM recovery_actions a
        JOIN infrastructure_services s ON a.service_id = s.id
        WHERE a.failure_count > 0
        ORDER BY a.failure_count DESC
        LIMIT 5
      `),
      // Improving actions
      db.query(`
        SELECT a.action_name, a.consecutive_success, s.name as service_name
        FROM recovery_actions a
        JOIN infrastructure_services s ON a.service_id = s.id
        WHERE a.consecutive_success >= 3
        ORDER BY a.consecutive_success DESC
        LIMIT 5
      `),
      // Declining actions
      db.query(`
        SELECT a.action_name, a.consecutive_failure, s.name as service_name
        FROM recovery_actions a
        JOIN infrastructure_services s ON a.service_id = s.id
        WHERE a.consecutive_failure >= 2
        ORDER BY a.consecutive_failure DESC
        LIMIT 5
      `),
    ]);

    const overallRow = getFirstRow(overallResult);
    const totalSuccess = parseInt(String(overallRow?.total_success || '0'), 10);
    const totalFailure = parseInt(String(overallRow?.total_failure || '0'), 10);
    const totalExecutions = totalSuccess + totalFailure;

    const mttrRow = getFirstRow(mttrResult);
    const mttrSeconds = mttrRow?.avg_seconds ? Math.round(parseFloat(String(mttrRow.avg_seconds))) : null;

    const pendingCount = parseInt(String(getFirstRow(pendingResult)?.count || '0'), 10);
    const activeIncidents = parseInt(String(getFirstRow(activeResult)?.count || '0'), 10);

    const daemonRow = getFirstRow(daemonResult);
    const isRunning = daemonRow?.created_at
      ? new Date().getTime() - new Date(String(daemonRow.created_at)).getTime() < 120000
      : false;

    const commonFailures = getRows(commonFailuresResult).map((row: Record<string, unknown>) => ({
      actionName: row.action_name,
      serviceName: row.service_name,
      failureCount: row.failure_count,
    }));

    // Build response
    const response: Record<string, unknown> = {
      overall: {
        successRate: totalExecutions > 0 ? Math.round((totalSuccess / totalExecutions) * 100) : null,
        totalSuccess,
        totalFailure,
      },
      mttr: {
        seconds: mttrSeconds,
        formatted: mttrSeconds ? formatDuration(mttrSeconds) : 'N/A',
        incidentCount: parseInt(String(mttrRow?.incident_count || '0'), 10),
      },
      today: todayStats,
      pending: {
        approvals: pendingCount,
      },
      incidents: {
        active: activeIncidents,
      },
      commonFailures,
      trends: {
        improving: getRows(improvingResult).map((row: Record<string, unknown>) => ({
          actionName: row.action_name,
          serviceName: row.service_name,
          consecutiveSuccess: row.consecutive_success,
        })),
        declining: getRows(decliningResult).map((row: Record<string, unknown>) => ({
          actionName: row.action_name,
          serviceName: row.service_name,
          consecutiveFailure: row.consecutive_failure,
        })),
      },
      daemon: {
        isRunning,
        lastCheck: daemonRow?.last_check || null,
      },
    };

    // Include recovery history if requested
    if (includeHistory === 'true') {
      const historyResult = await db.query(`
        SELECT
          ia.id,
          ra.action_name,
          s.name as service_name,
          COALESCE(ia.executed_at, ia.created_at) as executed_at,
          ia.success,
          ia.execution_time_ms as duration
        FROM incident_actions ia
        JOIN recovery_actions ra ON ia.action_id = ra.id
        JOIN infrastructure_services s ON ra.service_id = s.id
        ORDER BY COALESCE(ia.executed_at, ia.created_at) DESC NULLS LAST
        LIMIT 20
      `);
      response.history = getRows(historyResult).map((row: Record<string, unknown>) => ({
        id: row.id,
        actionName: row.action_name,
        serviceName: row.service_name,
        executedAt: row.executed_at,
        success: row.success,
        duration: row.duration || 0,
      }));
    }

    return apiResponse.success(res, response);
  } catch (err) {
    log.error('Failed to get system stats', { error: err });
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to get statistics');
  }
}

function getFirstRow(result: unknown): Record<string, unknown> | null {
  if (Array.isArray(result)) return result[0] || null;
  if (result && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: Record<string, unknown>[] }).rows[0] || null;
  }
  return null;
}

function getRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: Record<string, unknown>[] }).rows || [];
  }
  return [];
}

async function getTodayStats(db: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}): Promise<{ autoFixes: number; escalations: number; incidents: number }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [autoFixes, escalations, incidents] = await Promise.all([
    db.query(
      `SELECT COUNT(*) as count FROM incident_actions WHERE created_at >= $1 AND success = true`,
      [today]
    ),
    db.query(`SELECT COUNT(*) as count FROM recovery_approval_queue WHERE requested_at >= $1`, [
      today,
    ]),
    db.query(`SELECT COUNT(*) as count FROM infrastructure_incidents WHERE created_at >= $1`, [
      today,
    ]),
  ]);

  return {
    autoFixes: parseInt(getFirstRow(autoFixes)?.count?.toString() || '0', 10),
    escalations: parseInt(getFirstRow(escalations)?.count?.toString() || '0', 10),
    incidents: parseInt(getFirstRow(incidents)?.count?.toString() || '0', 10),
  };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

export default withAuth(withRole('super_admin')(withErrorHandler(handler)));

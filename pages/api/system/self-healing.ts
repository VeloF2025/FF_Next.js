/**
 * Self-Healing System API
 *
 * GET  /api/system/self-healing - Get self-healing dashboard data
 * POST /api/system/self-healing - Control daemon or trigger recovery
 *
 * NOTE: The AI Recovery Agent runs as a standalone Python daemon on Velocity
 * server (100.96.203.105) as systemd service 'ai-recovery-agent.service'.
 * This API reads its status from database activity.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withRole } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withErrorHandler } from '@/lib/api-error-handler';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      return getDashboard(req, res);
    case 'POST':
      return handleAction(req, res);
    default:
      return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  }
}

async function getDashboard(req: NextApiRequest, res: NextApiResponse) {
  const module = await import('@/lib/db');
  const db = module.db || module.default;
  if (!db) {
    return apiResponse.error(res, ErrorCode.DATABASE_ERROR, 'Database not available');
  }

  // Get Python daemon status from recent health logs
  const daemonStatusResult = await db.query(`
    SELECT
      timestamp as last_check,
      overall_status,
      total_services as services_checked,
      healthy_count,
      down_count,
      created_at,
      apps,
      ai_services,
      messaging,
      databases,
      infrastructure
    FROM system_health_logs
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const latestLog = Array.isArray(daemonStatusResult)
    ? daemonStatusResult[0]
    : daemonStatusResult?.rows?.[0];

  // Extract services from the health log JSON columns
  const extractServices = (log: Record<string, unknown> | null) => {
    if (!log) return [];
    const services: Array<{
      serviceId: string;
      serviceName: string;
      status: string;
      responseTimeMs: number | null;
    }> = [];

    const categories = ['apps', 'ai_services', 'messaging', 'databases', 'infrastructure'];
    for (const cat of categories) {
      const items = log[cat] as Array<{ name: string; status: string; latency_ms?: number }> | null;
      if (Array.isArray(items)) {
        for (const item of items) {
          services.push({
            serviceId: item.name?.replace(/\s+/g, '-').toLowerCase() || 'unknown',
            serviceName: item.name || 'Unknown',
            status: item.status || 'unknown',
            responseTimeMs: item.latency_ms ?? null,
          });
        }
      }
    }
    return services;
  };

  const services = extractServices(latestLog);

  // Determine if daemon is running (active if last check within 2 minutes)
  const isRunning = latestLog
    ? new Date().getTime() - new Date(latestLog.created_at).getTime() < 120000
    : false;

  // Count health log cycles in last hour to estimate cycle count
  const cycleCountResult = await db.query(`
    SELECT COUNT(*) as count, MIN(created_at) as earliest
    FROM system_health_logs
    WHERE created_at > NOW() - INTERVAL '1 hour'
  `);
  const cycleRow = Array.isArray(cycleCountResult)
    ? cycleCountResult[0]
    : cycleCountResult?.rows?.[0];

  // Get pending approvals
  const pendingApprovalsResult = await db.query(`
    SELECT
      q.id,
      q.approval_token as token,
      q.requested_at,
      q.token_expires_at as expires_at,
      a.action_name,
      a.risk_level,
      s.name as service_name,
      i.error_message as reason
    FROM recovery_approval_queue q
    JOIN recovery_actions a ON q.action_id = a.id
    JOIN infrastructure_services s ON a.service_id = s.id
    LEFT JOIN infrastructure_incidents i ON q.incident_id = i.id
    WHERE q.status = 'pending'
    ORDER BY q.requested_at DESC
    LIMIT 20
  `);
  const pendingApprovals = (
    Array.isArray(pendingApprovalsResult)
      ? pendingApprovalsResult
      : pendingApprovalsResult?.rows || []
  ).map((row: Record<string, unknown>) => ({
    id: row.id,
    actionName: row.action_name,
    serviceName: row.service_name,
    riskLevel: row.risk_level,
    requestedAt: row.requested_at,
    expiresAt: row.expires_at,
    reason: row.reason,
  }));

  // Get AI suggestions from learning engine data
  const suggestionsResult = await db.query(`
    SELECT
      a.id,
      a.action_name,
      a.risk_level as current_risk_level,
      a.consecutive_success,
      a.consecutive_failure,
      s.name as service_name,
      CASE
        WHEN a.consecutive_failure >= 3 AND a.risk_level = 'safe' THEN 'moderate'
        WHEN a.consecutive_failure >= 3 AND a.risk_level = 'moderate' THEN 'dangerous'
        WHEN a.consecutive_success >= 10 AND a.risk_level = 'dangerous' THEN 'moderate'
        WHEN a.consecutive_success >= 10 AND a.risk_level = 'moderate' THEN 'safe'
        ELSE NULL
      END as suggested_risk_level
    FROM recovery_actions a
    JOIN infrastructure_services s ON a.service_id = s.id
    WHERE a.consecutive_failure >= 3 OR a.consecutive_success >= 10
  `);
  const suggestions = (
    Array.isArray(suggestionsResult) ? suggestionsResult : suggestionsResult?.rows || []
  )
    .filter((row: Record<string, unknown>) => row.suggested_risk_level !== null)
    .map((row: Record<string, unknown>) => ({
      id: row.id,
      serviceName: row.service_name,
      actionName: row.action_name,
      currentRiskLevel: row.current_risk_level,
      suggestedRiskLevel: row.suggested_risk_level,
      rationale:
        (row.consecutive_failure as number) >= 3
          ? `${row.consecutive_failure} consecutive failures`
          : `${row.consecutive_success} consecutive successes`,
    }));

  // Get stats from recovery_actions
  const statsResult = await db.query(`
    SELECT
      SUM(success_count) as total_success,
      SUM(failure_count) as total_failure,
      COUNT(*) as total_actions
    FROM recovery_actions
  `);
  const statsRow = Array.isArray(statsResult) ? statsResult[0] : statsResult?.rows?.[0];
  const totalSuccess = parseInt(statsRow?.total_success || '0', 10);
  const totalFailure = parseInt(statsRow?.total_failure || '0', 10);
  const totalExecutions = totalSuccess + totalFailure;

  // Get incident count and MTTR
  const incidentStatsResult = await db.query(`
    SELECT
      COUNT(*) as incident_count,
      AVG(time_to_resolve_seconds) as avg_resolution_time
    FROM infrastructure_incidents
    WHERE resolved = true
  `);
  const incidentStatsRow = Array.isArray(incidentStatsResult)
    ? incidentStatsResult[0]
    : incidentStatsResult?.rows?.[0];

  // Get recent activity
  const recentActivity = await getRecentActivity();

  // Get services count
  const servicesCountResult = await db.query(`
    SELECT COUNT(*) as count FROM infrastructure_services WHERE is_enabled = true
  `);
  const servicesCount = parseInt(
    (Array.isArray(servicesCountResult)
      ? servicesCountResult[0]
      : servicesCountResult?.rows?.[0]
    )?.count || '0',
    10
  );

  return apiResponse.success(res, {
    health: {
      overall: latestLog?.overall_status || 'unknown',
      healthyCount: latestLog?.healthy_count || 0,
      unhealthyCount: latestLog?.down_count || 0,
      criticalDown: (latestLog?.down_count || 0) > 0,
      services,
    },
    daemon: {
      isRunning,
      lastCheck: latestLog?.last_check || null,
      startedAt: cycleRow?.earliest || null,
      intervalMs: 60000, // Python daemon runs every 60s
      cycleCount: parseInt(cycleRow?.count || '0', 10),
      errorCount: 0, // Would need separate tracking
    },
    stats: {
      successRate: totalExecutions > 0 ? Math.round((totalSuccess / totalExecutions) * 100) : null,
      mttrSeconds: incidentStatsRow?.avg_resolution_time
        ? Math.round(parseFloat(incidentStatsRow.avg_resolution_time))
        : null,
      incidentCount: parseInt(incidentStatsRow?.incident_count || '0', 10),
    },
    pendingApprovals,
    suggestions,
    recentActivity,
    serviceCount: servicesCount,
  });
}

async function handleAction(req: NextApiRequest, res: NextApiResponse) {
  const { action, queueId, approved, serviceId } = req.body;

  const module = await import('@/lib/db');
  const db = module.db || module.default;

  switch (action) {
    case 'start-daemon':
      // Start the Python daemon on Velocity via SSH
      try {
        const { execSync } = await import('child_process');
        execSync(
          `sshpass -p 'velo2026' ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S systemctl start ai-recovery-agent.service"`,
          { timeout: 10000 }
        );
        return apiResponse.success(res, {
          message: 'AI Recovery Agent started on Velocity',
        });
      } catch (err) {
        log.error('Failed to start daemon', { error: err });
        return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to start daemon');
      }

    case 'stop-daemon':
      // Stop the Python daemon on Velocity via SSH
      try {
        const { execSync } = await import('child_process');
        execSync(
          `sshpass -p 'velo2026' ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S systemctl stop ai-recovery-agent.service"`,
          { timeout: 10000 }
        );
        return apiResponse.success(res, {
          message: 'AI Recovery Agent stopped on Velocity',
        });
      } catch (err) {
        log.error('Failed to stop daemon', { error: err });
        return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to stop daemon');
      }

    case 'trigger-check':
      // Send SIGHUP to trigger immediate check (daemon handles this)
      // Or just return success - next check happens within 60s anyway
      return apiResponse.success(res, {
        message: 'Health check will run in the next cycle (within 60s)',
      });

    case 'approve-action':
      if (!queueId) {
        return apiResponse.badRequest(res, 'queueId required');
      }
      if (!db) {
        return apiResponse.error(res, ErrorCode.DATABASE_ERROR, 'Database not available');
      }
      await db.query(
        `UPDATE recovery_approval_queue
         SET status = $1, decided_at = NOW(), decided_by = $2
         WHERE id = $3::uuid`,
        [approved ? 'approved' : 'rejected', req.body.decidedBy || 'dashboard', queueId]
      );
      return apiResponse.success(res, {
        message: approved ? 'Action approved' : 'Action rejected',
      });

    case 'expire-approvals':
      if (!db) {
        return apiResponse.error(res, ErrorCode.DATABASE_ERROR, 'Database not available');
      }
      const expireResult = await db.query(`
        UPDATE recovery_approval_queue
        SET status = 'expired', decided_at = NOW()
        WHERE status = 'pending' AND token_expires_at < NOW()
        RETURNING id
      `);
      const expiredCount = Array.isArray(expireResult)
        ? expireResult.length
        : expireResult?.rowCount || 0;
      return apiResponse.success(res, {
        message: `Expired ${expiredCount} old approvals`,
        count: expiredCount,
      });

    default:
      return apiResponse.badRequest(res, 'Invalid action');
  }
}

async function getRecentActivity(): Promise<
  Array<{
    id: string;
    type: string;
    description: string;
    timestamp: Date;
    success?: boolean;
  }>
> {
  const module = await import('@/lib/db');
  const db = module.db || module.default;
  if (!db) {
    return [];
  }

  try {
    // Get recent health logs as activity
    const healthLogs = await db.query(`
      SELECT
        id,
        'health_check' as type,
        CONCAT('Health check: ', healthy_count, ' healthy, ', down_count, ' down') as description,
        created_at as timestamp,
        (down_count = 0) as success
      FROM system_health_logs
      ORDER BY created_at DESC
      LIMIT 5
    `);

    // Get recent incidents
    const incidents = await db.query(`
      SELECT
        i.id,
        'incident_created' as type,
        CONCAT('Issue detected: ', COALESCE(i.issue_type, 'unknown'), ' on ', COALESCE(s.name, 'unknown')) as description,
        i.created_at as timestamp,
        NULL::boolean as success
      FROM infrastructure_incidents i
      LEFT JOIN infrastructure_services s ON i.service_id = s.id
      ORDER BY i.created_at DESC
      LIMIT 5
    `);

    // Get recent action executions
    const actions = await db.query(`
      SELECT
        ia.id,
        'action_executed' as type,
        CONCAT(ra.action_name, ' - ', CASE WHEN ia.success THEN 'Success' ELSE 'Failed' END) as description,
        COALESCE(ia.executed_at, ia.created_at) as timestamp,
        ia.success
      FROM incident_actions ia
      JOIN recovery_actions ra ON ia.action_id = ra.id
      ORDER BY COALESCE(ia.executed_at, ia.created_at) DESC NULLS LAST
      LIMIT 5
    `);

    // Get recent approval decisions
    const approvals = await db.query(`
      SELECT
        q.id,
        'approval_decided' as type,
        CONCAT(ra.action_name, ' - ', q.status) as description,
        q.decided_at as timestamp,
        (q.status = 'approved') as success
      FROM recovery_approval_queue q
      JOIN recovery_actions ra ON q.action_id = ra.id
      WHERE q.status IN ('approved', 'rejected') AND q.decided_at IS NOT NULL
      ORDER BY q.decided_at DESC
      LIMIT 5
    `);

    // Combine and sort all activity
    const healthRows = Array.isArray(healthLogs) ? healthLogs : healthLogs?.rows || [];
    const incidentRows = Array.isArray(incidents) ? incidents : incidents?.rows || [];
    const actionRows = Array.isArray(actions) ? actions : actions?.rows || [];
    const approvalRows = Array.isArray(approvals) ? approvals : approvals?.rows || [];

    const allActivity = [...healthRows, ...incidentRows, ...actionRows, ...approvalRows]
      .filter((row) => row.timestamp)
      .sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      .slice(0, 15);

    return allActivity;
  } catch (err) {
    log.error('Failed to get recent activity', { error: err });
    return [];
  }
}

export default withAuth(withRole('super_admin')(withErrorHandler(handler)));

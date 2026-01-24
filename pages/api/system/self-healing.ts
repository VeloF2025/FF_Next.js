/**
 * Self-Healing System API
 *
 * GET  /api/system/self-healing - Get self-healing dashboard data
 * POST /api/system/self-healing - Control daemon or trigger recovery
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withRole } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { withErrorHandler } from '@/lib/apiErrorHandler';
import { healthDaemon } from '@/modules/system/services/healthDaemon';
import { recoveryService } from '@/modules/system/services/recoveryService';
import { escalationService } from '@/modules/system/services/escalationService';
import { incidentLearningService } from '@/modules/system/services/incidentLearning';
import { serviceRegistry } from '@/modules/system/services/serviceRegistry';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      return getDashboard(req, res);
    case 'POST':
      return handleAction(req, res);
    default:
      res.setHeader('Allow', ['GET', 'POST']);
      return apiResponse.error(res, 'Method not allowed', 405);
  }
}

async function getDashboard(req: NextApiRequest, res: NextApiResponse) {
  const [
    aggregatedHealth,
    services,
    pendingApprovals,
    suggestions,
    stats,
    daemonStatus,
  ] = await Promise.all([
    healthDaemon.getAggregatedHealth(),
    serviceRegistry.getEnabledServices(),
    recoveryService.getPendingApprovals(),
    incidentLearningService.getSuggestions('pending'),
    incidentLearningService.exportStatsAsJSON(),
    Promise.resolve(healthDaemon.getDaemonStatus()),
  ]);

  // Get recent activity
  const recentActivity = await getRecentActivity();

  return apiResponse.success(res, {
    health: {
      overall: aggregatedHealth.overall,
      services: aggregatedHealth.services,
      healthyCount: aggregatedHealth.healthyCount,
      unhealthyCount: aggregatedHealth.unhealthyCount,
      criticalDown: aggregatedHealth.criticalDown,
    },
    daemon: daemonStatus,
    stats: {
      successRate: stats.overallSuccessRate,
      mttrSeconds: stats.mttrSeconds,
      incidentCount: stats.incidentCount,
    },
    pendingApprovals,
    suggestions,
    recentActivity,
    serviceCount: services.length,
  });
}

async function handleAction(req: NextApiRequest, res: NextApiResponse) {
  const { action, serviceId, incidentId } = req.body;

  switch (action) {
    case 'start-daemon':
      healthDaemon.startDaemon();
      return apiResponse.success(res, {
        message: 'Daemon started',
        status: healthDaemon.getDaemonStatus(),
      });

    case 'stop-daemon':
      healthDaemon.stopDaemon();
      return apiResponse.success(res, {
        message: 'Daemon stopped',
        status: healthDaemon.getDaemonStatus(),
      });

    case 'trigger-check':
      await healthDaemon.runMonitoringCycle();
      return apiResponse.success(res, {
        message: 'Health check triggered',
        status: healthDaemon.getDaemonStatus(),
      });

    case 'trigger-recovery':
      if (!serviceId || !incidentId) {
        return apiResponse.error(res, 'serviceId and incidentId required', 400);
      }
      const result = await recoveryService.triggerRecovery(serviceId, incidentId);
      return apiResponse.success(res, result);

    case 'expire-approvals':
      const count = await escalationService.expireOldApprovals();
      return apiResponse.success(res, {
        message: `Expired ${count} old approvals`,
        count,
      });

    default:
      return apiResponse.error(res, 'Invalid action', 400);
  }
}

async function getRecentActivity(): Promise<Array<{
  id: string;
  type: string;
  description: string;
  timestamp: Date;
  success?: boolean;
}>> {
  const { db } = await import('@/lib/db');

  // Get recent incidents, actions, and approvals
  const result = await db.query(`
    (
      SELECT
        i.id,
        'incident_created' as type,
        CONCAT('Issue detected: ', COALESCE(i.issue_type, 'unknown'), ' on ', s.name) as description,
        i.created_at as timestamp,
        NULL as success
      FROM infrastructure_incidents i
      LEFT JOIN infrastructure_services s ON i.service_id = s.id
      ORDER BY i.created_at DESC
      LIMIT 5
    )
    UNION ALL
    (
      SELECT
        ia.id,
        'action_executed' as type,
        CONCAT(ra.action_name, ' - ', CASE WHEN ia.success THEN 'Success' ELSE 'Failed' END) as description,
        ia.executed_at as timestamp,
        ia.success
      FROM incident_actions ia
      JOIN recovery_actions ra ON ia.action_id = ra.id
      ORDER BY ia.executed_at DESC
      LIMIT 5
    )
    UNION ALL
    (
      SELECT
        q.id,
        'approval_decided' as type,
        CONCAT(ra.action_name, ' - ', q.status) as description,
        q.decided_at as timestamp,
        q.execution_success as success
      FROM recovery_approval_queue q
      JOIN recovery_actions ra ON q.action_id = ra.id
      WHERE q.status IN ('approved', 'rejected')
      ORDER BY q.decided_at DESC
      LIMIT 5
    )
    ORDER BY timestamp DESC
    LIMIT 15
  `);

  return result.rows;
}

export default withAuth(withRole('super_admin')(withErrorHandler(handler)));

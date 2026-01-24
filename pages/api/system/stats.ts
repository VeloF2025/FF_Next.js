/**
 * System Statistics API
 *
 * GET /api/system/stats - Get system statistics
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withRole } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { withErrorHandler } from '@/lib/api-error-handler';
import { incidentLearningService } from '@/modules/system/services/incidentLearning';
import { escalationService } from '@/modules/system/services/escalationService';
import { healthDaemon } from '@/modules/system/services/healthDaemon';
import { db } from '@/lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const { period } = req.query;

  // Get all stats in parallel
  const [
    overallRate,
    mttr,
    commonFailures,
    pendingCount,
    daemonStatus,
    improvingActions,
    decliningActions,
    activeIncidents,
    todayStats,
  ] = await Promise.all([
    incidentLearningService.getOverallSuccessRate(),
    incidentLearningService.getMTTR(),
    incidentLearningService.getCommonFailures(),
    escalationService.getPendingCount(),
    Promise.resolve(healthDaemon.getDaemonStatus()),
    incidentLearningService.getImprovingActions(),
    incidentLearningService.getDecliningActions(),
    getActiveIncidentCount(),
    getTodayStats(),
  ]);

  // Get period comparison if requested
  let periodComparison = null;
  if (period === 'weekly') {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    periodComparison = await incidentLearningService.compareTimePeriods(
      { from: weekAgo, to: now },
      { from: twoWeeksAgo, to: weekAgo }
    );
  }

  return apiResponse.success(res, {
    overall: {
      successRate: overallRate.rate,
      totalSuccess: overallRate.totalSuccess,
      totalFailure: overallRate.totalFailure,
    },
    mttr: {
      seconds: mttr.mttrSeconds,
      formatted: mttr.mttrFormatted,
      incidentCount: mttr.incidentCount,
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
      improving: improvingActions,
      declining: decliningActions,
    },
    daemon: daemonStatus,
    periodComparison,
  });
}

async function getActiveIncidentCount(): Promise<number> {
  const result = await db.query(`
    SELECT COUNT(*) as count
    FROM infrastructure_incidents
    WHERE resolved = false
  `);
  return parseInt(result.rows[0]?.count || 0, 10);
}

async function getTodayStats(): Promise<{ autoFixes: number; escalations: number; incidents: number }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [autoFixes, escalations, incidents] = await Promise.all([
    db.query(
      `SELECT COUNT(*) as count FROM incident_actions WHERE executed_at >= $1 AND success = true`,
      [today]
    ),
    db.query(
      `SELECT COUNT(*) as count FROM recovery_approval_queue WHERE requested_at >= $1`,
      [today]
    ),
    db.query(
      `SELECT COUNT(*) as count FROM infrastructure_incidents WHERE created_at >= $1`,
      [today]
    ),
  ]);

  return {
    autoFixes: parseInt(autoFixes.rows[0]?.count || 0, 10),
    escalations: parseInt(escalations.rows[0]?.count || 0, 10),
    incidents: parseInt(incidents.rows[0]?.count || 0, 10),
  };
}

export default withAuth(withRole('super_admin')(withErrorHandler(handler)));

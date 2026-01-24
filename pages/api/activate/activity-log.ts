/**
 * API Route: /api/activate/activity-log
 *
 * Purpose: Get activity timeline for a DR or recent activity across all DRs
 * Method: GET
 *
 * Query params:
 * - dropNumber: Get activity for specific DR
 * - limit: Max entries to return (default: 50)
 * - project: Filter by project (for recent activity)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  getActivityTimeline,
  getActivitySummary,
  getRecentActivity,
} from '@/modules/activate/services/activityLogService';

/**
 * GET /api/activate/activity-log
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  try {
    const { dropNumber, limit = '50', project, summary } = req.query;

    const limitNum = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 100);

    // If dropNumber provided, get timeline for that DR
    if (dropNumber && typeof dropNumber === 'string') {
      // If summary requested, return summary only
      if (summary === 'true') {
        const activitySummary = await getActivitySummary(dropNumber);
        return apiResponse.success(res, activitySummary);
      }

      // Get full timeline
      log.info('ActivityLog', `Getting timeline for ${dropNumber}, limit ${limitNum}`);
      const timeline = await getActivityTimeline(dropNumber, limitNum);
      log.info('ActivityLog', `Got ${timeline.length} events for ${dropNumber}`);

      return apiResponse.success(res, {
        dropNumber,
        totalEvents: timeline.length,
        timeline,
        _version: '2026-01-20-v2',
      });
    }

    // Otherwise, get recent activity across all DRs
    const projectFilter = typeof project === 'string' ? project : undefined;
    const recentActivity = await getRecentActivity(limitNum, projectFilter);

    return apiResponse.success(res, {
      totalEvents: recentActivity.length,
      project: projectFilter || 'all',
      activity: recentActivity.map((entry) => ({
        id: entry.id,
        drNumber: entry.drop_number,
        eventType: entry.event_type,
        eventData: entry.event_data,
        actor: entry.actor,
        createdAt: entry.created_at,
      })),
    });
  } catch (error) {
    log.error('ActivityLog', 'Error getting activity', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Main handler
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method === 'GET') {
    return handleGet(req, res);
  } else {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }
}

export default withAuth(handler);

/**
 * GET /api/qfield/qa-stats
 * Dashboard statistics for QField QA
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthenticatedRequest } from '@/lib/auth';

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  try {
    const authReq = req as unknown as AuthenticatedRequest;
    const currentUser = authReq.user?.email || authReq.user?.username;
    const { projectId } = req.query;

    // Get overall counts by workflow status
    const statusCounts = projectId
      ? await sql`
          SELECT workflow_status, COUNT(*) as count
          FROM qfield_photo_validations
          WHERE project_id = ${projectId}::uuid
          GROUP BY workflow_status
        `
      : await sql`
          SELECT workflow_status, COUNT(*) as count
          FROM qfield_photo_validations
          GROUP BY workflow_status
        `;

    // Get counts by AI result
    const aiCounts = projectId
      ? await sql`
          SELECT
            CASE
              WHEN vlm_confidence IS NULL THEN 'not_validated'
              WHEN vlm_confidence >= 0.8 THEN 'high_confidence'
              WHEN vlm_confidence >= 0.6 THEN 'medium_confidence'
              ELSE 'low_confidence'
            END as confidence_level,
            COUNT(*) as count
          FROM qfield_photo_validations
          WHERE project_id = ${projectId}::uuid
          GROUP BY confidence_level
        `
      : await sql`
          SELECT
            CASE
              WHEN vlm_confidence IS NULL THEN 'not_validated'
              WHEN vlm_confidence >= 0.8 THEN 'high_confidence'
              WHEN vlm_confidence >= 0.6 THEN 'medium_confidence'
              ELSE 'low_confidence'
            END as confidence_level,
            COUNT(*) as count
          FROM qfield_photo_validations
          GROUP BY confidence_level
        `;

    // Get needs retake count
    const retakeCounts = projectId
      ? await sql`
          SELECT
            COUNT(*) FILTER (WHERE needs_retake = TRUE AND retake_completed_at IS NULL) as needs_retake,
            COUNT(*) FILTER (WHERE needs_retake = TRUE AND retake_completed_at IS NOT NULL) as retaken
          FROM qfield_photo_validations
          WHERE project_id = ${projectId}::uuid
        `
      : await sql`
          SELECT
            COUNT(*) FILTER (WHERE needs_retake = TRUE AND retake_completed_at IS NULL) as needs_retake,
            COUNT(*) FILTER (WHERE needs_retake = TRUE AND retake_completed_at IS NOT NULL) as retaken
          FROM qfield_photo_validations
        `;

    // Get escalated count
    const escalatedCount = projectId
      ? await sql`
          SELECT COUNT(*) as count
          FROM qfield_photo_validations
          WHERE escalation_level > 0
            AND workflow_status = 'escalated'
            AND project_id = ${projectId}::uuid
        `
      : await sql`
          SELECT COUNT(*) as count
          FROM qfield_photo_validations
          WHERE escalation_level > 0
            AND workflow_status = 'escalated'
        `;

    // Get overdue count (past due date, not completed)
    const overdueCount = projectId
      ? await sql`
          SELECT COUNT(*) as count
          FROM qfield_photo_validations
          WHERE due_date < NOW()
            AND workflow_status IN ('pending', 'in_review')
            AND project_id = ${projectId}::uuid
        `
      : await sql`
          SELECT COUNT(*) as count
          FROM qfield_photo_validations
          WHERE due_date < NOW()
            AND workflow_status IN ('pending', 'in_review')
        `;

    // Get my queue count if user is logged in
    let myQueueCount = 0;
    if (currentUser) {
      const myQueue = projectId
        ? await sql`
            SELECT COUNT(*) as count
            FROM qfield_photo_validations
            WHERE assigned_to = ${currentUser}
              AND workflow_status IN ('pending', 'in_review')
              AND project_id = ${projectId}::uuid
          `
        : await sql`
            SELECT COUNT(*) as count
            FROM qfield_photo_validations
            WHERE assigned_to = ${currentUser}
              AND workflow_status IN ('pending', 'in_review')
          `;
      myQueueCount = parseInt(myQueue[0]?.count || '0', 10);
    }

    // Get counts by work type
    const workTypeCounts = projectId
      ? await sql`
          SELECT
            COALESCE(work_type, 'unknown') as work_type,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE workflow_status = 'approved') as approved,
            COUNT(*) FILTER (WHERE workflow_status = 'rejected') as rejected,
            COUNT(*) FILTER (WHERE workflow_status = 'pending') as pending,
            AVG(vlm_confidence) FILTER (WHERE vlm_confidence IS NOT NULL) as avg_confidence
          FROM qfield_photo_validations
          WHERE project_id = ${projectId}::uuid
          GROUP BY work_type
          ORDER BY total DESC
        `
      : await sql`
          SELECT
            COALESCE(work_type, 'unknown') as work_type,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE workflow_status = 'approved') as approved,
            COUNT(*) FILTER (WHERE workflow_status = 'rejected') as rejected,
            COUNT(*) FILTER (WHERE workflow_status = 'pending') as pending,
            AVG(vlm_confidence) FILTER (WHERE vlm_confidence IS NOT NULL) as avg_confidence
          FROM qfield_photo_validations
          GROUP BY work_type
          ORDER BY total DESC
        `;

    // Get counts by priority
    const priorityCounts = projectId
      ? await sql`
          SELECT
            COALESCE(priority, 'normal') as priority,
            COUNT(*) as count
          FROM qfield_photo_validations
          WHERE workflow_status IN ('pending', 'in_review')
            AND project_id = ${projectId}::uuid
          GROUP BY priority
        `
      : await sql`
          SELECT
            COALESCE(priority, 'normal') as priority,
            COUNT(*) as count
          FROM qfield_photo_validations
          WHERE workflow_status IN ('pending', 'in_review')
          GROUP BY priority
        `;

    // Get recent activity
    const recentActivity = await sql`
      SELECT
        action_type,
        action_by,
        action_at,
        notes
      FROM qfield_qa_actions
      ORDER BY action_at DESC
      LIMIT 10
    `;

    // Build response
    const stats = {
      summary: {
        total: statusCounts.reduce((sum, s) => sum + parseInt(s.count, 10), 0),
        pending: parseInt(statusCounts.find(s => s.workflow_status === 'pending')?.count || '0', 10),
        in_review: parseInt(statusCounts.find(s => s.workflow_status === 'in_review')?.count || '0', 10),
        approved: parseInt(statusCounts.find(s => s.workflow_status === 'approved')?.count || '0', 10),
        rejected: parseInt(statusCounts.find(s => s.workflow_status === 'rejected')?.count || '0', 10),
        escalated: parseInt(escalatedCount[0]?.count || '0', 10),
        overdue: parseInt(overdueCount[0]?.count || '0', 10),
        needs_retake: parseInt(retakeCounts[0]?.needs_retake || '0', 10),
        my_queue: myQueueCount,
      },
      ai_confidence: {
        not_validated: parseInt(aiCounts.find(c => c.confidence_level === 'not_validated')?.count || '0', 10),
        high_confidence: parseInt(aiCounts.find(c => c.confidence_level === 'high_confidence')?.count || '0', 10),
        medium_confidence: parseInt(aiCounts.find(c => c.confidence_level === 'medium_confidence')?.count || '0', 10),
        low_confidence: parseInt(aiCounts.find(c => c.confidence_level === 'low_confidence')?.count || '0', 10),
      },
      by_work_type: workTypeCounts.map(wt => ({
        work_type: wt.work_type,
        total: parseInt(wt.total, 10),
        approved: parseInt(wt.approved, 10),
        rejected: parseInt(wt.rejected, 10),
        pending: parseInt(wt.pending, 10),
        avg_confidence: wt.avg_confidence ? parseFloat(wt.avg_confidence).toFixed(2) : null,
      })),
      by_priority: {
        low: parseInt(priorityCounts.find(p => p.priority === 'low')?.count || '0', 10),
        normal: parseInt(priorityCounts.find(p => p.priority === 'normal')?.count || '0', 10),
        high: parseInt(priorityCounts.find(p => p.priority === 'high')?.count || '0', 10),
        urgent: parseInt(priorityCounts.find(p => p.priority === 'urgent')?.count || '0', 10),
      },
      recent_activity: recentActivity,
    };

    return apiResponse.success(res, stats);
  } catch (error) {
    log.error('qfield-qa-stats', error instanceof Error ? { message: error.message } : { error }, 'Stats fetch failed');
    return apiResponse.databaseError(res, error);
  }
}

export default withAuth(handler);

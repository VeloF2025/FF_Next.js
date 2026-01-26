/**
 * Project Maintenance Summary API
 * GET /api/projects/[projectId]/maintenance-summary
 *
 * Returns maintenance ticket summary by status and resolution metrics
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const getSql = () => neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.validationError(res, { projectId: 'Project ID is required' });
  }

  try {
    const sql = getSql();

    // Check project exists
    const projectExists = await sql`
      SELECT id FROM projects WHERE id = ${projectId}
    `;

    if (!projectExists || projectExists.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    // Get ticket counts by status (project_id is TEXT)
    const statusCounts = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'open') as open,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
        COUNT(*) FILTER (WHERE status = 'closed') as closed,
        COUNT(*) FILTER (WHERE status NOT IN ('closed', 'resolved')) as active
      FROM maintenance_tickets
      WHERE project_id::text = ${projectId}
    `;

    // Get resolution metrics
    const resolutionMetrics = await sql`
      SELECT
        AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600) as avg_resolution_hours,
        MIN(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600) as min_resolution_hours,
        MAX(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600) as max_resolution_hours,
        COUNT(*) as resolved_count
      FROM maintenance_tickets
      WHERE project_id::text = ${projectId}
      AND resolved_at IS NOT NULL
    `;

    // Get recent activity (last 30 days)
    const recentActivity = await sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as created_last_30_days,
        COUNT(*) FILTER (WHERE resolved_at >= NOW() - INTERVAL '30 days') as resolved_last_30_days
      FROM maintenance_tickets
      WHERE project_id::text = ${projectId}
    `;

    // Get priority breakdown
    const priorityBreakdown = await sql`
      SELECT
        COUNT(*) FILTER (WHERE priority = 'critical') as critical,
        COUNT(*) FILTER (WHERE priority = 'high') as high,
        COUNT(*) FILTER (WHERE priority = 'medium') as medium,
        COUNT(*) FILTER (WHERE priority = 'low') as low
      FROM maintenance_tickets
      WHERE project_id::text = ${projectId}
      AND status NOT IN ('closed', 'resolved')
    `;

    // Format response
    const response = {
      total: Number(statusCounts[0]?.total) || 0,
      open: Number(statusCounts[0]?.open) || 0,
      inProgress: Number(statusCounts[0]?.in_progress) || 0,
      resolved: Number(statusCounts[0]?.resolved) || 0,
      closed: Number(statusCounts[0]?.closed) || 0,
      active: Number(statusCounts[0]?.active) || 0,

      avgResolutionHours: resolutionMetrics[0]?.avg_resolution_hours
        ? Math.round(Number(resolutionMetrics[0].avg_resolution_hours) * 10) / 10
        : null,
      minResolutionHours: resolutionMetrics[0]?.min_resolution_hours
        ? Math.round(Number(resolutionMetrics[0].min_resolution_hours) * 10) / 10
        : null,
      maxResolutionHours: resolutionMetrics[0]?.max_resolution_hours
        ? Math.round(Number(resolutionMetrics[0].max_resolution_hours) * 10) / 10
        : null,

      createdLast30Days: Number(recentActivity[0]?.created_last_30_days) || 0,
      resolvedLast30Days: Number(recentActivity[0]?.resolved_last_30_days) || 0,

      priorityBreakdown: {
        critical: Number(priorityBreakdown[0]?.critical) || 0,
        high: Number(priorityBreakdown[0]?.high) || 0,
        medium: Number(priorityBreakdown[0]?.medium) || 0,
        low: Number(priorityBreakdown[0]?.low) || 0,
      },
    };

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('Error fetching maintenance summary', { error, projectId });
    return apiResponse.internalError(res, error as Error);
  }
}

export default withAuth(handler);

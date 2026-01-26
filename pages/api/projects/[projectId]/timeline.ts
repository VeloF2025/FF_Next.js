/**
 * Project Timeline API
 * GET /api/projects/[projectId]/timeline
 *
 * Returns cross-module activity feed for a project
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const getSql = () => neon(process.env.DATABASE_URL!);

interface Activity {
  id: string;
  module: string;
  type: string;
  description: string;
  timestamp: string;
  actor?: string;
  reference?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { projectId, limit = '20' } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.validationError(res, { projectId: 'Project ID is required' });
  }

  const limitNum = Math.min(Math.max(parseInt(limit as string) || 20, 1), 100);

  try {
    const sql = getSql();

    // Check project exists
    const projectExists = await sql`
      SELECT id FROM projects WHERE id = ${projectId}
    `;

    if (!projectExists || projectExists.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    // Get activities from multiple modules using UNION ALL
    const activities = await sql`
      -- Purchase Orders
      SELECT
        id::text as id,
        'procurement' as module,
        'po_' || status as type,
        'PO ' || po_number || ' ' || CASE
          WHEN status = 'approved' THEN 'approved'
          WHEN status = 'pending_approval' THEN 'submitted for approval'
          WHEN status = 'completed' THEN 'completed'
          ELSE status
        END as description,
        COALESCE(updated_at, created_at) as timestamp,
        NULL as actor,
        po_number as reference
      FROM purchase_orders
      WHERE project_id = ${projectId}
      AND (updated_at IS NOT NULL OR created_at IS NOT NULL)

      UNION ALL

      -- Maintenance Tickets
      SELECT
        id::text as id,
        'maintenance' as module,
        'ticket_' || status as type,
        'Ticket ' || ticket_uid || ' ' || CASE
          WHEN status = 'resolved' THEN 'resolved'
          WHEN status = 'closed' THEN 'closed'
          WHEN status = 'open' THEN 'opened'
          WHEN status = 'in_progress' THEN 'work started'
          ELSE status
        END as description,
        COALESCE(resolved_at, updated_at, created_at) as timestamp,
        NULL as actor,
        ticket_uid as reference
      FROM maintenance_tickets
      WHERE project_id::text = ${projectId}
      AND (resolved_at IS NOT NULL OR updated_at IS NOT NULL OR created_at IS NOT NULL)

      UNION ALL

      -- H&S Audits
      SELECT
        id::text as id,
        'hs' as module,
        'audit_completed' as type,
        'H&S Audit completed - Score: ' || overall_score || '%' as description,
        created_at as timestamp,
        NULL as actor,
        NULL as reference
      FROM hs_project_audits
      WHERE project_id = ${projectId}

      ORDER BY timestamp DESC NULLS LAST
      LIMIT ${limitNum}
    `;

    // Format response
    const response: Activity[] = activities.map(activity => ({
      id: activity.id,
      module: activity.module,
      type: activity.type,
      description: activity.description,
      timestamp: activity.timestamp?.toISOString() || new Date().toISOString(),
      actor: activity.actor || undefined,
      reference: activity.reference || undefined,
    }));

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('Error fetching project timeline', { error, projectId });
    return apiResponse.internalError(res, error as Error);
  }
}

export default withAuth(handler);

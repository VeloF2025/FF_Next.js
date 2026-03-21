/**
 * GET /api/qfield/qa-projects
 * Get QField projects for filtering
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';

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
    // Get projects with validation counts
    const projects = await sql`
      SELECT
        qp.id,
        qp.name,
        qp.description,
        qp.is_active,
        qp.sync_enabled,
        COUNT(v.id) as validation_count,
        COUNT(v.id) FILTER (WHERE v.workflow_status = 'pending') as pending_count,
        COUNT(v.id) FILTER (WHERE v.needs_retake = TRUE) as needs_retake_count
      FROM qfield_projects qp
      LEFT JOIN qfield_photo_validations v ON qp.id = v.project_id
      WHERE qp.is_active = TRUE
      GROUP BY qp.id, qp.name, qp.description, qp.is_active, qp.sync_enabled
      ORDER BY qp.name
    `;

    return apiResponse.success(res, projects);
  } catch (error) {
    log.error('qfield-qa-projects', error instanceof Error ? { message: error.message } : { error }, 'Fetch failed');
    return apiResponse.databaseError(res, error);
  }
}

export default withAuth(handler);

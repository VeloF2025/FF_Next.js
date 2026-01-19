/**
 * API Route: /api/activate/staff-by-project
 *
 * Purpose: Fetch staff members for a project (for QA feedback tagging)
 * Method: GET
 *
 * Query params:
 *   - project: Project name (e.g., "Lawley", "Mohadin")
 *
 * Returns staff assigned to the project via staff_projects.
 * Falls back to ALL active staff with whatsapp_id if no project assignments exist.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

interface StaffOption {
  id: string;
  name: string;
  whatsappId: string | null;
  position: string | null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { project } = req.query;

    if (!project || typeof project !== 'string') {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'project parameter is required');
    }

    log.info('Fetching staff for project:', { project });

    // First, try to get staff assigned to this project via staff_projects
    const projectStaff = await pool.query<StaffOption>(
      `
      SELECT
        s.id,
        CONCAT(s.first_name, ' ', s.last_name) as name,
        s.whatsapp_id as "whatsappId",
        s.position
      FROM staff s
      INNER JOIN staff_projects sp ON s.id = sp.staff_id
      INNER JOIN projects p ON sp.project_id = p.id
      WHERE p.project_name = $1
        AND sp.is_active = true
        AND LOWER(s.status) = 'active'
      ORDER BY s.first_name, s.last_name
      `,
      [project]
    );

    if (projectStaff.rows.length > 0) {
      log.info('Found staff via project assignment', {
        project,
        count: projectStaff.rows.length,
      });
      return apiResponse.success(res, {
        staff: projectStaff.rows,
        source: 'project_assignment',
      });
    }

    // Fallback: Get ALL active staff (no project filter)
    // Only include staff with whatsapp_id for the tagging feature
    const allStaff = await pool.query<StaffOption>(
      `
      SELECT
        s.id,
        CONCAT(s.first_name, ' ', s.last_name) as name,
        s.whatsapp_id as "whatsappId",
        s.position
      FROM staff s
      WHERE LOWER(s.status) = 'active'
      ORDER BY s.first_name, s.last_name
      `
    );

    log.info('Fallback: returning all active staff', {
      project,
      count: allStaff.rows.length,
    });

    return apiResponse.success(res, {
      staff: allStaff.rows,
      source: 'all_staff_fallback',
    });
  } catch (error) {
    log.error('Error fetching staff by project:', error);
    return apiResponse.internalError(res, error);
  }
}

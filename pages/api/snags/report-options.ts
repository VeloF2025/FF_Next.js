/**
 * Snag Report Options API
 * GET /api/snags/report-options[?projectId=<uuid>]
 * Returns distinct assignees who have snags, for the report filter dropdown.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

interface AssigneeOption {
  id: string;
  name: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET']);
  }

  try {
    const { projectId } = req.query;
    const scoped = typeof projectId === 'string' && projectId ? projectId : null;

    type Row = { id: string; name: string };

    const rows = await sql`
      SELECT DISTINCT
        u.id::text AS id,
        (u.first_name || ' ' || u.last_name) AS name
      FROM snags s
      JOIN users u ON u.id = s.assigned_to
      WHERE s.assigned_to IS NOT NULL
        AND (${scoped}::uuid IS NULL OR s.project_id = ${scoped}::uuid)
      ORDER BY name ASC
    ` as Row[];

    const assignees: AssigneeOption[] = rows.map((r) => ({ id: r.id, name: r.name }));

    return apiResponse.success(res, { assignees });
  } catch (error) {
    log.error('Snag report-options API error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

/**
 * H&S Per-Project Competency Gap API
 *
 * GET /api/health-safety/training/competency?project_id=<uuid>
 *
 * Builds a gap matrix for one project: every worker who has training recorded
 * against the project × every active statutory training type, with each cell
 * resolved to current / expiring_soon / expired / missing. "missing" is the
 * gap a supervisor must close before the safety file is complete.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { EXPIRING_SOON_DAYS } from '@/modules/health-safety/types/training.types';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const { project_id } = req.query;
  if (!project_id || typeof project_id !== 'string') {
    return apiResponse.badRequest(res, 'project_id is required');
  }

  try {
    // Worker set = anyone with training recorded against this project. The
    // LATERAL pulls each worker's latest record per statutory type; a NULL
    // completed_date means the worker has no record for that type = a gap.
    const cells = await sql`
      WITH proj_workers AS (
        SELECT DISTINCT staff_id, team_member_id, contractor_id, worker_name
        FROM hs_worker_training
        WHERE project_id = ${project_id}::uuid
      ),
      stat_types AS (
        SELECT id, code, name
        FROM hs_training_types
        WHERE is_active = true AND is_statutory = true
      )
      SELECT
        pw.worker_name, pw.staff_id, pw.team_member_id, pw.contractor_id,
        st.id AS training_type_id, st.code AS training_code, st.name AS training_name,
        latest.completed_date, latest.expiry_date,
        CASE
          WHEN latest.completed_date IS NULL THEN 'missing'
          WHEN latest.expiry_date IS NULL THEN 'current'
          WHEN latest.expiry_date < CURRENT_DATE THEN 'expired'
          WHEN latest.expiry_date <= CURRENT_DATE + make_interval(days => ${EXPIRING_SOON_DAYS}) THEN 'expiring_soon'
          ELSE 'current'
        END AS competency_status
      FROM proj_workers pw
      CROSS JOIN stat_types st
      LEFT JOIN LATERAL (
        SELECT w.completed_date, w.expiry_date
        FROM hs_worker_training w
        WHERE w.project_id = ${project_id}::uuid
          AND w.training_type_id = st.id
          AND w.staff_id IS NOT DISTINCT FROM pw.staff_id
          AND w.team_member_id IS NOT DISTINCT FROM pw.team_member_id
        ORDER BY w.completed_date DESC
        LIMIT 1
      ) latest ON true
      ORDER BY pw.worker_name, st.name
    `;

    const summary = {
      workers: new Set(cells.map((c) => c.worker_name)).size,
      cells: cells.length,
      current: cells.filter((c) => c.competency_status === 'current').length,
      expiring_soon: cells.filter((c) => c.competency_status === 'expiring_soon').length,
      expired: cells.filter((c) => c.competency_status === 'expired').length,
      missing: cells.filter((c) => c.competency_status === 'missing').length,
    };

    return apiResponse.success(res, { project_id, cells, summary });
  } catch (error) {
    log.error('[H&S Competency API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

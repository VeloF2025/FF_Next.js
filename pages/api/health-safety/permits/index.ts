/**
 * H&S Permits API
 *
 * GET  /api/health-safety/permits - List permits (filters: project_id, status)
 *      with the EFFECTIVE status (expired permits surface as expired)
 * POST /api/health-safety/permits - Request a permit
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import { withHsPermission } from '@/modules/health-safety/services/hsAuth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res);
      case 'POST':
        return handlePost(req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
    }
  } catch (error) {
    log.error('[H&S Permits API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : null;
  const status = typeof req.query.status === 'string' ? req.query.status : null;

  // effective_status derives expiry from valid_to in SQL — an approved/active
  // permit past its window reads as 'expired' without a stored write.
  const permits = await sql`
    SELECT
      pm.*, t.name AS type_name, t.code AS type_code, p.project_name,
      CASE
        WHEN pm.status IN ('approved','active') AND pm.valid_to IS NOT NULL AND pm.valid_to < NOW()
          THEN 'expired'
        ELSE pm.status
      END AS effective_status
    FROM hs_permits pm
    JOIN hs_permit_types t ON t.id = pm.permit_type_id
    LEFT JOIN projects p ON p.id = pm.project_id
    WHERE (${projectId}::uuid IS NULL OR pm.project_id = ${projectId}::uuid)
      AND (${status}::text IS NULL OR pm.status = ${status}::text)
    ORDER BY pm.created_at DESC
  `;

  return apiResponse.success(res, { permits });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const { permit_type_id, project_id, title, work_description, location, valid_from, valid_to, notes } = req.body;

  if (!permit_type_id || !title) {
    return apiResponse.badRequest(res, 'permit_type_id and title are required');
  }
  if (valid_from && valid_to && String(valid_to) < String(valid_from)) {
    return apiResponse.badRequest(res, 'valid_to cannot be before valid_from');
  }

  const [type] = await sql`SELECT id, name FROM hs_permit_types WHERE id = ${permit_type_id} LIMIT 1`;
  if (!type) {
    return apiResponse.badRequest(res, 'Unknown permit_type_id');
  }

  // Human-readable permit number: PTW-YYYYMMDD-NNN. The sequence is MAX(existing
  // suffix)+1 for the day, NOT COUNT+1 — COUNT would deterministically collide
  // after a same-day delete (delete P002 of 003 → COUNT 2 → next seq 3 → clashes
  // with the still-present P003). The unique index remains the backstop against
  // a concurrent race.
  const now = new Date();
  const ymd = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  const prefix = `PTW-${ymd}-`;
  const seqRows = await sql`
    SELECT COALESCE(MAX((split_part(permit_number, '-', 3))::int), 0) + 1 AS next_seq
    FROM hs_permits WHERE permit_number LIKE ${prefix + '%'}
  `;
  const permitNumber = `${prefix}${String(Number(seqRows[0]?.next_seq ?? 1)).padStart(3, '0')}`;

  const rows = await sql`
    INSERT INTO hs_permits (
      permit_type_id, permit_number, project_id, title, work_description, location,
      status, valid_from, valid_to, requested_by, notes, created_by
    ) VALUES (
      ${permit_type_id}, ${permitNumber}, ${project_id || null}, ${title}, ${work_description || null}, ${location || null},
      'requested', ${valid_from || null}::timestamptz, ${valid_to || null}::timestamptz, ${user?.id ?? null}, ${notes || null}, ${user?.id ?? null}
    )
    RETURNING *
  `;

  await logHsActivity({
    activityType: 'permit_requested',
    entityType: 'permit',
    entityId: rows[0]!.id as string,
    description: `Permit requested: ${permitNumber} (${type.name})`,
    metadata: { project_id: project_id || null },
    user,
  });

  return apiResponse.created(res, rows[0]);
}

export default withHsPermission(handler);

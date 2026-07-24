/**
 * H&S Injuries API
 *
 * GET  /api/health-safety/injuries - List classified injuries (filter: project_id)
 * POST /api/health-safety/injuries - Record a classified injury
 * DELETE /api/health-safety/injuries?id=… - Remove an injury record
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import { INJURY_CLASSIFICATIONS } from '@/modules/health-safety/types/ltifr.types';
import { withHsPermission } from '@/modules/health-safety/services/hsAuth';

const sql = neon(process.env.DATABASE_URL!);
const VALID_CLASS = new Set(INJURY_CLASSIFICATIONS.map((c) => c.value));

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res);
      case 'POST':
        return handlePost(req, res);
      case 'DELETE':
        return handleDelete(req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'DELETE']);
    }
  } catch (error) {
    log.error('[H&S Injuries API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : null;
  const rows = await sql`
    SELECT i.*, p.project_name
    FROM hs_injuries i
    LEFT JOIN projects p ON p.id = i.project_id
    WHERE (${projectId}::uuid IS NULL OR i.project_id = ${projectId}::uuid)
    ORDER BY i.injury_date DESC
  `;
  return apiResponse.success(res, { injuries: rows });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const { project_id, ticket_id, injury_date, classification, days_lost, body_part, description } = req.body;

  if (!injury_date) {
    return apiResponse.badRequest(res, 'injury_date is required');
  }
  if (!VALID_CLASS.has(classification)) {
    return apiResponse.badRequest(res, `classification must be one of: ${[...VALID_CLASS].join(', ')}`);
  }
  // days_lost defaults to 0 when omitted, but a supplied value must be valid —
  // don't silently coerce a negative/non-integer to 0.
  if (days_lost != null && (!Number.isInteger(days_lost) || days_lost < 0)) {
    return apiResponse.badRequest(res, 'days_lost must be a non-negative integer');
  }
  const days = Number.isInteger(days_lost) ? days_lost : 0;

  const rows = await sql`
    INSERT INTO hs_injuries (project_id, ticket_id, injury_date, classification, days_lost, body_part, description, created_by)
    VALUES (${project_id || null}, ${ticket_id || null}, ${injury_date}, ${classification}, ${days}, ${body_part || null}, ${description || null}, ${user?.id ?? null})
    RETURNING *
  `;

  await logHsActivity({
    activityType: 'injury_recorded',
    entityType: 'injury',
    entityId: rows[0]!.id as string,
    description: `Injury recorded (${classification}) on ${String(injury_date).slice(0, 10)}`,
    metadata: { classification, days_lost: days },
    user,
  });

  return apiResponse.created(res, rows[0]);
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  const id = typeof req.query.id === 'string' ? req.query.id : null;
  if (!id) {
    return apiResponse.badRequest(res, 'id query param is required');
  }
  const rows = await sql`DELETE FROM hs_injuries WHERE id = ${id} RETURNING id`;
  if (rows.length === 0) {
    return apiResponse.notFound(res, 'Injury record', id);
  }
  return apiResponse.success(res, { deleted: true, id });
}

export default withHsPermission(handler);

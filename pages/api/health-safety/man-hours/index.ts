/**
 * H&S Man-Hours API
 *
 * GET  /api/health-safety/man-hours - List (filter: project_id, year)
 * POST /api/health-safety/man-hours - Upsert hours for a project × period
 * DELETE /api/health-safety/man-hours?id=… - Remove a man-hours row
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';

const sql = neon(process.env.DATABASE_URL!);

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
    log.error('[H&S Man-Hours API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : null;
  const rows = await sql`
    SELECT m.*, p.project_name
    FROM hs_man_hours m
    LEFT JOIN projects p ON p.id = m.project_id
    WHERE (${projectId}::uuid IS NULL OR m.project_id = ${projectId}::uuid)
    ORDER BY m.period_year DESC, m.period_month DESC
  `;
  return apiResponse.success(res, { man_hours: rows });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const { project_id, period_year, period_month, hours_worked, headcount, notes } = req.body;

  if (!Number.isInteger(period_year) || !Number.isInteger(period_month) || period_month < 1 || period_month > 12) {
    return apiResponse.badRequest(res, 'period_year and period_month (1-12) are required integers');
  }
  const hours = Number(hours_worked);
  if (!Number.isFinite(hours) || hours < 0) {
    return apiResponse.badRequest(res, 'hours_worked must be a non-negative number');
  }

  // Upsert on (project_id, period) — explicit branch rather than ON CONFLICT,
  // because the uniqueness is enforced by two PARTIAL indexes (project_id NULL
  // vs not), which ON CONFLICT arbiters cannot both target cleanly.
  const [existing] = await sql`
    SELECT id FROM hs_man_hours
    WHERE period_year = ${period_year} AND period_month = ${period_month}
      AND project_id IS NOT DISTINCT FROM ${project_id || null}::uuid
    LIMIT 1
  `;

  const rows = existing
    ? await sql`
        UPDATE hs_man_hours
        SET hours_worked = ${hours}, headcount = ${Number.isInteger(headcount) ? headcount : null}, notes = ${notes || null}, updated_at = NOW()
        WHERE id = ${existing.id}
        RETURNING *
      `
    : await sql`
        INSERT INTO hs_man_hours (project_id, period_year, period_month, hours_worked, headcount, notes, created_by)
        VALUES (${project_id || null}, ${period_year}, ${period_month}, ${hours}, ${Number.isInteger(headcount) ? headcount : null}, ${notes || null}, ${user?.id ?? null})
        RETURNING *
      `;
  const row = rows[0]!;

  await logHsActivity({
    activityType: existing ? 'man_hours_updated' : 'man_hours_recorded',
    entityType: 'man_hours',
    entityId: row.id as string,
    description: `Man-hours ${existing ? 'updated' : 'recorded'}: ${hours}h for ${period_year}-${String(period_month).padStart(2, '0')}`,
    user,
  });

  return apiResponse.success(res, row);
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  const id = typeof req.query.id === 'string' ? req.query.id : null;
  if (!id) {
    return apiResponse.badRequest(res, 'id query param is required');
  }
  const rows = await sql`DELETE FROM hs_man_hours WHERE id = ${id} RETURNING id`;
  if (rows.length === 0) {
    return apiResponse.notFound(res, 'Man-hours record', id);
  }
  return apiResponse.success(res, { deleted: true, id });
}

export default withAuth(handler);

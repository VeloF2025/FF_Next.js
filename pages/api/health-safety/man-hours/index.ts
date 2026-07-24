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
  const year = typeof req.query.year === 'string' && /^\d{4}$/.test(req.query.year) ? parseInt(req.query.year, 10) : null;
  const rows = await sql`
    SELECT m.*, p.project_name
    FROM hs_man_hours m
    LEFT JOIN projects p ON p.id = m.project_id
    WHERE (${projectId}::uuid IS NULL OR m.project_id = ${projectId}::uuid)
      AND (${year}::int IS NULL OR m.period_year = ${year}::int)
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

  // Atomic upsert via ON CONFLICT — no check-then-act race. The uniqueness is
  // enforced by two PARTIAL indexes (project_id NULL vs not), so the arbiter
  // must reproduce the matching predicate; branch on whether a project is given.
  const hc = Number.isInteger(headcount) ? headcount : null;
  const rows = project_id
    ? await sql`
        INSERT INTO hs_man_hours (project_id, period_year, period_month, hours_worked, headcount, notes, created_by)
        VALUES (${project_id}, ${period_year}, ${period_month}, ${hours}, ${hc}, ${notes || null}, ${user?.id ?? null})
        ON CONFLICT (project_id, period_year, period_month) WHERE project_id IS NOT NULL
        DO UPDATE SET hours_worked = EXCLUDED.hours_worked, headcount = EXCLUDED.headcount, notes = EXCLUDED.notes, updated_at = NOW()
        RETURNING *, (xmax = 0) AS inserted
      `
    : await sql`
        INSERT INTO hs_man_hours (project_id, period_year, period_month, hours_worked, headcount, notes, created_by)
        VALUES (NULL, ${period_year}, ${period_month}, ${hours}, ${hc}, ${notes || null}, ${user?.id ?? null})
        ON CONFLICT (period_year, period_month) WHERE project_id IS NULL
        DO UPDATE SET hours_worked = EXCLUDED.hours_worked, headcount = EXCLUDED.headcount, notes = EXCLUDED.notes, updated_at = NOW()
        RETURNING *, (xmax = 0) AS inserted
      `;
  const row = rows[0]!;
  const existing = row.inserted !== true; // xmax=0 → freshly inserted, else updated

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

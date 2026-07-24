/**
 * H&S Permit Types API
 *
 * GET  /api/health-safety/permits/types - List permit types (with preconditions)
 * POST /api/health-safety/permits/types - Create a permit type
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';

const sql = neon(process.env.DATABASE_URL!);

interface RawPrecondition { text?: unknown; required?: unknown }

function cleanPreconditions(input: unknown): { text: string; required: boolean }[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((p: RawPrecondition) => ({ text: typeof p?.text === 'string' ? p.text.trim() : '', required: p?.required === true }))
    .filter((p) => p.text.length > 0);
}

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
    log.error('[H&S Permit Types API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const types =
    req.query.include_inactive === 'true'
      ? await sql`SELECT * FROM hs_permit_types ORDER BY sort_order, name`
      : await sql`SELECT * FROM hs_permit_types WHERE is_active = true ORDER BY sort_order, name`;
  return apiResponse.success(res, { types });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const { code, name, description, preconditions, sort_order } = req.body;

  if (!code || !name) {
    return apiResponse.badRequest(res, 'code and name are required');
  }
  const [existing] = await sql`SELECT id FROM hs_permit_types WHERE code = ${code} LIMIT 1`;
  if (existing) {
    return apiResponse.badRequest(res, `A permit type with code "${code}" already exists`);
  }

  const preconds = cleanPreconditions(preconditions);

  const rows = await sql`
    INSERT INTO hs_permit_types (code, name, description, preconditions, sort_order, created_by)
    VALUES (${code}, ${name}, ${description || null}, ${JSON.stringify(preconds)}::jsonb, ${Number.isInteger(sort_order) ? sort_order : 0}, ${user?.id ?? null})
    RETURNING *
  `;

  await logHsActivity({
    activityType: 'permit_type_created',
    entityType: 'permit_type',
    entityId: rows[0]!.id as string,
    description: `Permit type created: ${name}`,
    user,
  });

  return apiResponse.created(res, rows[0]);
}

export default withAuth(handler);

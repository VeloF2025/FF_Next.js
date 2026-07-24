/**
 * H&S PPE Catalogue API
 *
 * GET  /api/health-safety/ppe/catalogue - List PPE types
 * POST /api/health-safety/ppe/catalogue - Create a PPE type
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import { PPE_CATEGORIES } from '@/modules/health-safety/types/ppe.types';

const sql = neon(process.env.DATABASE_URL!);

const VALID_CATEGORIES = new Set(PPE_CATEGORIES.map((c) => c.value));

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
    log.error('[H&S PPE Catalogue API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const items =
    req.query.include_inactive === 'true'
      ? await sql`SELECT * FROM hs_ppe_catalogue ORDER BY sort_order, name`
      : await sql`SELECT * FROM hs_ppe_catalogue WHERE is_active = true ORDER BY sort_order, name`;
  return apiResponse.success(res, { items });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const { code, name, description, category, lifespan_months, sizes, sort_order } = req.body;

  if (!code || !name) {
    return apiResponse.badRequest(res, 'code and name are required');
  }
  if (lifespan_months != null && (!Number.isInteger(lifespan_months) || lifespan_months <= 0)) {
    return apiResponse.badRequest(res, 'lifespan_months must be a positive integer or null');
  }
  if (category != null && !VALID_CATEGORIES.has(category)) {
    return apiResponse.badRequest(res, `category must be one of: ${[...VALID_CATEGORIES].join(', ')}`);
  }

  const [existing] = await sql`SELECT id FROM hs_ppe_catalogue WHERE code = ${code} LIMIT 1`;
  if (existing) {
    return apiResponse.badRequest(res, `A PPE type with code "${code}" already exists`);
  }

  const sizeArr = Array.isArray(sizes) ? sizes.filter((s) => typeof s === 'string') : [];

  const rows = await sql`
    INSERT INTO hs_ppe_catalogue (code, name, description, category, lifespan_months, sizes, sort_order, created_by)
    VALUES (
      ${code}, ${name}, ${description || null}, ${category || 'other'},
      ${lifespan_months ?? null}, ${JSON.stringify(sizeArr)}::jsonb,
      ${Number.isInteger(sort_order) ? sort_order : 0}, ${user?.id ?? null}
    )
    RETURNING *
  `;

  await logHsActivity({
    activityType: 'ppe_type_created',
    entityType: 'ppe_catalogue',
    entityId: rows[0]!.id as string,
    description: `PPE type created: ${name}`,
    user,
  });

  return apiResponse.created(res, rows[0]);
}

export default withAuth(handler);

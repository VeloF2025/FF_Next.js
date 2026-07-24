/**
 * H&S Training Types API
 *
 * GET  /api/health-safety/training/types - List training/competency types
 * POST /api/health-safety/training/types - Create a training type
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
    log.error('[H&S Training Types API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { include_inactive } = req.query;

  const types =
    include_inactive === 'true'
      ? await sql`
          SELECT * FROM hs_training_types
          ORDER BY sort_order, name
        `
      : await sql`
          SELECT * FROM hs_training_types
          WHERE is_active = true
          ORDER BY sort_order, name
        `;

  return apiResponse.success(res, { types });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const userId = user?.id ?? null;
  const { code, name, description, validity_months, is_statutory, requires_certificate, sort_order } =
    req.body;

  if (!code || !name) {
    return apiResponse.badRequest(res, 'code and name are required');
  }
  if (validity_months != null && (!Number.isInteger(validity_months) || validity_months <= 0)) {
    return apiResponse.badRequest(res, 'validity_months must be a positive integer or null');
  }

  // Explicit duplicate check — friendlier than surfacing the unique-index error.
  const [existing] = await sql`
    SELECT id FROM hs_training_types WHERE code = ${code} LIMIT 1
  `;
  if (existing) {
    return apiResponse.badRequest(res, `A training type with code "${code}" already exists`);
  }

  const rows = await sql`
    INSERT INTO hs_training_types (
      code, name, description, validity_months,
      is_statutory, requires_certificate, sort_order, created_by
    ) VALUES (
      ${code},
      ${name},
      ${description || null},
      ${validity_months ?? null},
      ${is_statutory === true},
      ${requires_certificate !== false},
      ${Number.isInteger(sort_order) ? sort_order : 0},
      ${userId}
    )
    RETURNING *
  `;
  const type = rows[0]!;

  await logHsActivity({
    activityType: 'training_type_created',
    entityType: 'training_type',
    entityId: type.id as string,
    description: `Training type created: ${name}`,
    metadata: { code, is_statutory: is_statutory === true },
    user,
  });

  return apiResponse.created(res, type);
}

export default withHsPermission(handler);

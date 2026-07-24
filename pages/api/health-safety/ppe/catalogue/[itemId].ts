/**
 * H&S PPE Catalogue item detail API
 *
 * PATCH /api/health-safety/ppe/catalogue/[itemId] - Update / (de)activate a PPE type
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import { PPE_CATEGORIES } from '@/modules/health-safety/types/ppe.types';
import { withHsPermission } from '@/modules/health-safety/services/hsAuth';

const sql = neon(process.env.DATABASE_URL!);

const VALID_CATEGORIES = new Set(PPE_CATEGORIES.map((c) => c.value));

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { itemId } = req.query;
  if (!itemId || typeof itemId !== 'string') {
    return apiResponse.badRequest(res, 'itemId is required');
  }
  if (req.method !== 'PATCH') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['PATCH']);
  }

  try {
    const user = getAuthUser(req);
    const { name, description, category, lifespan_months, sizes, is_active, sort_order } = req.body;
    if (lifespan_months != null && (!Number.isInteger(lifespan_months) || lifespan_months <= 0)) {
      return apiResponse.badRequest(res, 'lifespan_months must be a positive integer or null');
    }
    if (category != null && !VALID_CATEGORIES.has(category)) {
      return apiResponse.badRequest(res, `category must be one of: ${[...VALID_CATEGORIES].join(', ')}`);
    }
    const has = (k: string) => Object.prototype.hasOwnProperty.call(req.body, k);
    // If sizes is present it must be an array — reject a malformed value rather
    // than silently leaving the field unchanged.
    if (has('sizes') && !Array.isArray(sizes)) {
      return apiResponse.badRequest(res, 'sizes must be an array');
    }
    const sizeArr = has('sizes') ? (sizes as unknown[]).filter((s) => typeof s === 'string') : null;

    const rows = await sql`
      UPDATE hs_ppe_catalogue
      SET
        name = COALESCE(${name ?? null}, name),
        description = CASE WHEN ${has('description')} THEN ${description ?? null} ELSE description END,
        category = COALESCE(${category ?? null}, category),
        lifespan_months = CASE WHEN ${has('lifespan_months')} THEN ${lifespan_months ?? null}::int ELSE lifespan_months END,
        sizes = CASE WHEN ${sizeArr !== null} THEN ${JSON.stringify(sizeArr ?? [])}::jsonb ELSE sizes END,
        is_active = COALESCE(${typeof is_active === 'boolean' ? is_active : null}, is_active),
        sort_order = COALESCE(${Number.isInteger(sort_order) ? sort_order : null}, sort_order),
        updated_at = NOW()
      WHERE id = ${itemId}
      RETURNING *
    `;
    if (rows.length === 0) {
      return apiResponse.notFound(res, 'PPE type', itemId);
    }

    await logHsActivity({
      activityType: 'ppe_type_updated',
      entityType: 'ppe_catalogue',
      entityId: itemId,
      description: `PPE type updated: ${rows[0]!.name}`,
      user,
    });

    return apiResponse.success(res, rows[0]);
  } catch (error) {
    log.error('[H&S PPE Catalogue Item API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withHsPermission(handler);

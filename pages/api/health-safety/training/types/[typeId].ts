/**
 * H&S Training Type detail API
 *
 * PATCH /api/health-safety/training/types/[typeId] - Update / (de)activate a type
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
  const { typeId } = req.query;
  if (!typeId || typeof typeId !== 'string') {
    return apiResponse.badRequest(res, 'typeId is required');
  }

  try {
    if (req.method !== 'PATCH') {
      return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['PATCH']);
    }

    const user = getAuthUser(req);
    const { name, description, validity_months, is_statutory, requires_certificate, is_active, sort_order } =
      req.body;

    if (validity_months != null && (!Number.isInteger(validity_months) || validity_months <= 0)) {
      return apiResponse.badRequest(res, 'validity_months must be a positive integer or null');
    }

    // COALESCE keeps unspecified fields; validity_months is nullable so it is
    // only changed when the key is present in the body.
    const hasValidity = Object.prototype.hasOwnProperty.call(req.body, 'validity_months');

    const rows = await sql`
      UPDATE hs_training_types
      SET
        name = COALESCE(${name ?? null}, name),
        description = COALESCE(${description ?? null}, description),
        validity_months = CASE WHEN ${hasValidity} THEN ${validity_months ?? null}::int ELSE validity_months END,
        is_statutory = COALESCE(${typeof is_statutory === 'boolean' ? is_statutory : null}, is_statutory),
        requires_certificate = COALESCE(${typeof requires_certificate === 'boolean' ? requires_certificate : null}, requires_certificate),
        is_active = COALESCE(${typeof is_active === 'boolean' ? is_active : null}, is_active),
        sort_order = COALESCE(${Number.isInteger(sort_order) ? sort_order : null}, sort_order),
        updated_at = NOW()
      WHERE id = ${typeId}
      RETURNING *
    `;

    if (rows.length === 0) {
      return apiResponse.notFound(res, 'Training type', typeId);
    }
    const type = rows[0]!;

    await logHsActivity({
      activityType: 'training_type_updated',
      entityType: 'training_type',
      entityId: type.id as string,
      description: `Training type updated: ${type.name}`,
      metadata: { is_active: type.is_active },
      user,
    });

    return apiResponse.success(res, type);
  } catch (error) {
    log.error('[H&S Training Type API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withHsPermission(handler);

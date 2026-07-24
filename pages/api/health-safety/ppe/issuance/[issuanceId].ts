/**
 * H&S PPE Issuance detail API
 *
 * PATCH  /api/health-safety/ppe/issuance/[issuanceId] - Edit / capture acknowledgement
 * DELETE /api/health-safety/ppe/issuance/[issuanceId] - Delete an issue record
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import { captureESignature } from '@/modules/health-safety/services/esignature';
import { withHsPermission } from '@/modules/health-safety/services/hsAuth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { issuanceId } = req.query;
  if (!issuanceId || typeof issuanceId !== 'string') {
    return apiResponse.badRequest(res, 'issuanceId is required');
  }

  try {
    switch (req.method) {
      case 'PATCH':
        return handlePatch(issuanceId, req, res);
      case 'DELETE':
        return handleDelete(issuanceId, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['PATCH', 'DELETE']);
    }
  } catch (error) {
    log.error('[H&S PPE Issuance Detail API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handlePatch(issuanceId: string, req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const { size, quantity, issued_date, replacement_due, notes, signature_name } = req.body;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(req.body, k);

  if (has('quantity') && (!Number.isInteger(quantity) || quantity <= 0)) {
    return apiResponse.badRequest(res, 'quantity must be a positive integer');
  }

  // A newly-typed name captures a fresh acknowledgement signature server-side.
  const sig =
    typeof signature_name === 'string' && signature_name.trim().length > 0
      ? captureESignature(req, signature_name, user, new Date())
      : null;

  const rows = await sql`
    UPDATE hs_ppe_issuance
    SET
      size = CASE WHEN ${has('size')} THEN ${size ?? null} ELSE size END,
      quantity = COALESCE(${has('quantity') ? quantity : null}::int, quantity),
      issued_date = COALESCE(${issued_date ?? null}::date, issued_date),
      replacement_due = CASE WHEN ${has('replacement_due')} THEN ${replacement_due ?? null}::date ELSE replacement_due END,
      notes = CASE WHEN ${has('notes')} THEN ${notes ?? null} ELSE notes END,
      signature_name = COALESCE(${sig?.signature_name ?? null}, signature_name),
      signed_at = COALESCE(${sig?.signed_at ?? null}::timestamptz, signed_at),
      signed_by = COALESCE(${sig?.signed_by ?? null}, signed_by),
      signed_ip = COALESCE(${sig?.signed_ip ?? null}, signed_ip),
      updated_at = NOW()
    WHERE id = ${issuanceId}
    RETURNING *, issued_date::text AS issued_date, replacement_due::text AS replacement_due
  `;
  if (rows.length === 0) {
    return apiResponse.notFound(res, 'PPE issue', issuanceId);
  }

  await logHsActivity({
    activityType: sig ? 'ppe_acknowledged' : 'ppe_issue_updated',
    entityType: 'ppe_issuance',
    entityId: issuanceId,
    description: `PPE issue ${sig ? 'acknowledged' : 'updated'}: ${rows[0]!.worker_name}`,
    user,
  });

  return apiResponse.success(res, rows[0]);
}

async function handleDelete(issuanceId: string, req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const rows = await sql`DELETE FROM hs_ppe_issuance WHERE id = ${issuanceId} RETURNING id, worker_name`;
  if (rows.length === 0) {
    return apiResponse.notFound(res, 'PPE issue', issuanceId);
  }

  await logHsActivity({
    activityType: 'ppe_issue_deleted',
    entityType: 'ppe_issuance',
    entityId: issuanceId,
    description: `PPE issue deleted: ${rows[0]!.worker_name}`,
    user,
  });

  return apiResponse.success(res, { deleted: true, id: issuanceId });
}

export default withHsPermission(handler);

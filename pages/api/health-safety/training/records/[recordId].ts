/**
 * H&S Worker Training Record detail API
 *
 * PATCH  /api/health-safety/training/records/[recordId] - Update a record
 * DELETE /api/health-safety/training/records/[recordId] - Delete a record
 *
 * Both refresh the affected contractor's gate training score.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import { computeAndPersistContractorTrainingScore } from '@/modules/health-safety/services/trainingService';
import { withHsPermission } from '@/modules/health-safety/services/hsAuth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { recordId } = req.query;
  if (!recordId || typeof recordId !== 'string') {
    return apiResponse.badRequest(res, 'recordId is required');
  }

  try {
    switch (req.method) {
      case 'PATCH':
        return handlePatch(recordId, req, res);
      case 'DELETE':
        return handleDelete(recordId, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['PATCH', 'DELETE']);
    }
  } catch (error) {
    log.error('[H&S Training Record API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handlePatch(recordId: string, req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const { completed_date, expiry_date, certificate_url, certificate_number, issued_by, notes, project_id } =
    req.body;

  // has-key semantics for every nullable field: a field is changed only when
  // the caller includes its key, and an explicit null clears it. A plain
  // COALESCE would make it impossible to ever blank a certificate number.
  const has = (k: string) => Object.prototype.hasOwnProperty.call(req.body, k);
  const hasExpiry = has('expiry_date');
  const hasProject = has('project_id');
  const hasCertUrl = has('certificate_url');
  const hasCertNo = has('certificate_number');
  const hasIssuedBy = has('issued_by');
  const hasNotes = has('notes');

  const rows = await sql`
    UPDATE hs_worker_training
    SET
      completed_date = COALESCE(${completed_date ?? null}::date, completed_date),
      expiry_date = CASE WHEN ${hasExpiry} THEN ${expiry_date ?? null}::date ELSE expiry_date END,
      project_id = CASE WHEN ${hasProject} THEN ${project_id ?? null}::uuid ELSE project_id END,
      certificate_url = CASE WHEN ${hasCertUrl} THEN ${certificate_url ?? null} ELSE certificate_url END,
      certificate_number = CASE WHEN ${hasCertNo} THEN ${certificate_number ?? null} ELSE certificate_number END,
      issued_by = CASE WHEN ${hasIssuedBy} THEN ${issued_by ?? null} ELSE issued_by END,
      notes = CASE WHEN ${hasNotes} THEN ${notes ?? null} ELSE notes END,
      updated_at = NOW()
    WHERE id = ${recordId}
    RETURNING *, completed_date::text AS completed_date, expiry_date::text AS expiry_date
  `;

  if (rows.length === 0) {
    return apiResponse.notFound(res, 'Training record', recordId);
  }
  const record = rows[0]!;

  await logHsActivity({
    activityType: 'worker_training_updated',
    entityType: 'worker_training',
    entityId: record.id as string,
    description: `Training record updated for ${record.worker_name}`,
    metadata: { expiry_date: record.expiry_date },
    user,
  });

  if (record.contractor_id) {
    await computeAndPersistContractorTrainingScore(record.contractor_id as string);
  }

  return apiResponse.success(res, record);
}

async function handleDelete(recordId: string, req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);

  const rows = await sql`
    DELETE FROM hs_worker_training WHERE id = ${recordId}
    RETURNING id, worker_name, contractor_id
  `;
  if (rows.length === 0) {
    return apiResponse.notFound(res, 'Training record', recordId);
  }
  const record = rows[0]!;

  await logHsActivity({
    activityType: 'worker_training_deleted',
    entityType: 'worker_training',
    entityId: record.id as string,
    description: `Training record deleted for ${record.worker_name}`,
    user,
  });

  if (record.contractor_id) {
    await computeAndPersistContractorTrainingScore(record.contractor_id as string);
  }

  return apiResponse.success(res, { deleted: true, id: record.id });
}

export default withHsPermission(handler);

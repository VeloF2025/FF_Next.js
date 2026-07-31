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

/**
 * A certificate-linked row is not editable here, at any permission level.
 *
 * This endpoint is gated on projects.health-safety:edit — deliberately NOT the
 * dedicated certificate permission — and knows nothing about the lifecycle.
 * Left open, a broad H&S editor could extend a verified statutory competency's
 * expiry with no certificate, no verifier and no lifecycle event, and the gate
 * would keep counting it. Its dates and provider come from the certificate;
 * correcting them means revoking and uploading a new submission.
 *
 * Returns 409 rather than 403: the caller's permission is not the problem, the
 * record's provenance is.
 */
async function refuseIfCertificateLinked(
  recordId: string,
  res: NextApiResponse
): Promise<boolean> {
  const [row] = await sql`
    SELECT staff_document_id FROM hs_worker_training WHERE id = ${recordId}
  `;
  if (row?.staff_document_id) {
    apiResponse.conflict(
      res,
      'This competency is evidenced by an uploaded certificate and cannot be edited or removed here. Revoke the certificate instead, then upload a corrected one.'
    );
    return true;
  }
  return false;
}

async function handlePatch(recordId: string, req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  if (await refuseIfCertificateLinked(recordId, res)) return;

  const { completed_date, expiry_date, certificate_number, issued_by, notes, project_id } =
    req.body;

  // has-key semantics for every nullable field: a field is changed only when
  // the caller includes its key, and an explicit null clears it. A plain
  // COALESCE would make it impossible to ever blank a certificate number.
  const has = (k: string) => Object.prototype.hasOwnProperty.call(req.body, k);
  const hasExpiry = has('expiry_date');
  const hasProject = has('project_id');
  const hasCertNo = has('certificate_number');
  const hasIssuedBy = has('issued_by');
  const hasNotes = has('notes');

  const rows = await sql`
    UPDATE hs_worker_training
    SET
      completed_date = COALESCE(${completed_date ?? null}::date, completed_date),
      expiry_date = CASE WHEN ${hasExpiry} THEN ${expiry_date ?? null}::date ELSE expiry_date END,
      project_id = CASE WHEN ${hasProject} THEN ${project_id ?? null}::uuid ELSE project_id END,
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
  // Deleting the last linked row would strand the document forever: it could
  // never be revoked (the transition refuses a submission with no linked rows)
  // and never be deleted (verified/revoked are immutable), leaving the binary
  // unreachable in storage.
  if (await refuseIfCertificateLinked(recordId, res)) return;

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

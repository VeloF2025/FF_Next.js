/**
 * The certification branches of the staff-document routes: the verify/reject/
 * revoke transition, and deletion.
 *
 * They live outside the route files because both of those are already at or past
 * the 300-line limit, and these are self-contained: each owns its transaction,
 * its audit entries, and its error-to-status mapping.
 *
 * A certificate's state lives in two tables at once — the document and every
 * competency it evidences — so this runs in one transaction rather than the
 * OCR flow's sequence of independent statements. OCR-to-staff synchronisation is
 * skipped entirely: a training certificate carries no identity fields to sync.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import type { AuthenticatedNextApiRequest } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { queryOne, transaction } from '@/lib/db-pool';
import {
  transitionTrainingCertificate,
  deleteTrainingCertificateSubmission,
  type TrainingCertificateTransition,
} from './trainingCertificateService';
import { TrainingCertificateError } from './trainingCertificateValidation';
import { logHsActivity } from './activityLog';
import { computeAndPersistContractorTrainingScore } from './trainingService';
import { deleteStaffDocument } from '@/services/vfStorageAdapter';
import {
  logDocumentVerified,
  logDocumentRejected,
  logDocumentRevoked,
} from '@/services/staff/staffAuditService';

const logger = createLogger('TrainingCertificateVerify');

export async function handleCertificateTransition(
  req: NextApiRequest,
  res: NextApiResponse,
  documentId: string,
  input: { status: unknown; notes: unknown; userId: string; staffId: string }
) {
  const { status, notes, userId, staffId } = input;

  if (status !== 'verified' && status !== 'rejected' && status !== 'revoked') {
    return apiResponse.badRequest(
      res,
      'Invalid status. Must be "verified", "rejected" or "revoked"'
    );
  }

  const reason = typeof notes === 'string' ? notes : '';
  const transition = (
    status === 'verified' ? { status: 'verified' } : { status, reason }
  ) as TrainingCertificateTransition;

  // staff_documents.verified_by references staff(id) while the training rows
  // reference users(id); resolve the actor's staff row once, for the former.
  let actorStaffId: string | null = null;
  try {
    const staffMember = await queryOne<{ id: string }>(
      'SELECT id FROM staff WHERE user_id = $1',
      [userId]
    );
    actorStaffId = staffMember?.id ?? null;
  } catch {
    logger.warn('Could not resolve the verifier staff record', { userId });
  }

  try {
    const result = await transaction((txn) =>
      transitionTrainingCertificate(txn, documentId, { userId, staffId: actorStaffId }, transition)
    );

    if (!result.idempotent) {
      const ip = (req.headers['x-forwarded-for'] as string) || req.socket?.remoteAddress;
      const actorName = (req as AuthenticatedNextApiRequest).user?.name || 'System';
      if (status === 'verified') {
        await logDocumentVerified(staffId, 'certification', [], actorName, ip);
      } else if (status === 'rejected') {
        await logDocumentRejected(staffId, 'certification', reason, actorName, ip);
      } else {
        await logDocumentRevoked(staffId, 'certification', reason, actorName, ip);
      }
      await logHsActivity({
        activityType: `training_certificate_${status}`,
        entityType: 'staff_documents',
        entityId: documentId,
        description: `Training certificate ${status}`,
        metadata: {
          staffId,
          documentId,
          verificationStatus: result.status,
          contractorIds: result.contractorIds,
        },
        user: { id: userId },
      });
    }

    // The rollup counts verified rows, so verifying or revoking changes it.
    // After commit and best-effort: a stale score must not fail a request whose
    // write already succeeded. Internal-only v1 uploads carry no contractor, so
    // this is normally an empty list — it exists so the day contractor capture
    // ships, the score does not silently drift.
    for (const contractorId of result.contractorIds) {
      try {
        await computeAndPersistContractorTrainingScore(contractorId);
      } catch (error) {
        logger.warn('Recomputing the contractor training score failed', { contractorId, error });
      }
    }

    // Ids and state only — no storage path or URL.
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof TrainingCertificateError) {
      if (error.code === 'conflict' || error.code === 'immutable') {
        return apiResponse.conflict(res, error.message);
      }
      if (error.code === 'not_found') {
        return apiResponse.notFound(res, error.message);
      }
      return apiResponse.badRequest(res, error.message);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Training certificate transition failed', { documentId, error: message });
    return res.status(500).json({ error: 'Failed to update the certificate' });
  }
}


/**
 * Delete a certificate submission.
 *
 * The linked competencies reference the document under an ON DELETE RESTRICT
 * foreign key and verified or revoked evidence must survive deletion entirely,
 * so both rules are enforced inside one transaction. The stored object only goes
 * once that commits: an object deleted ahead of a rolled-back transaction would
 * leave a database row pointing at nothing.
 */
export async function handleCertificateDeletion(
  res: NextApiResponse,
  documentId: string
): Promise<void> {
  let removed: { staffId: string; fileName: string };
  try {
    removed = await transaction((txn) => deleteTrainingCertificateSubmission(txn, documentId));
  } catch (error) {
    if (error instanceof TrainingCertificateError) {
      if (error.code === 'immutable') return apiResponse.conflict(res, error.message);
      if (error.code === 'not_found') return apiResponse.notFound(res, error.message);
      return apiResponse.badRequest(res, error.message);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Training certificate deletion failed', { documentId, error: message });
    res.status(500).json({ error: 'Failed to delete the certificate' });
    return;
  }

  if (removed.fileName) {
    // Best effort: the database record is already gone, so a storage failure is
    // an operational cleanup task rather than a failed request.
    const deleted = await deleteStaffDocument(removed.staffId, removed.fileName).catch(() => false);
    if (!deleted) {
      logger.error('Orphaned training certificate requires cleanup', {
        staffId: removed.staffId,
        fileName: removed.fileName,
      });
    }
  }

  res.status(200).json({ success: true, message: 'Document deleted successfully' });
}

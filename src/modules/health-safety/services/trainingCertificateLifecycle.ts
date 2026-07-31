/**
 * Verification, rejection, revocation and deletion of a certificate submission.
 *
 * One document backs one or more competencies, so every transition writes all of
 * them or none: a partial update leaves a worker verified for some competencies
 * and pending for others, which no reader can tell apart from a genuine mixed
 * state. The caller supplies the transaction; this module never opens one.
 *
 * Split from trainingCertificateService to keep both files under the 300-line
 * limit; the service re-exports these so callers see one module.
 */

import type { SqlRow, TxnClient } from '@/lib/db-pool';
import type { TrainingVerificationStatus } from '../types/training.types';
import { TrainingCertificateError } from './trainingCertificateValidation';

export type TrainingCertificateTransition =
  | { status: 'verified' }
  | { status: 'rejected'; reason: string }
  | { status: 'revoked'; reason: string };

export interface TrainingCertificateActor {
  /** users(id) — stamped on hs_worker_training.verified_by / revoked_by. */
  userId: string;
  /** staff(id) — stamped on staff_documents.verified_by, which references staff. */
  staffId: string | null;
}

export interface TrainingCertificateTransitionResult {
  documentId: string;
  staffId: string;
  status: TrainingVerificationStatus;
  /** Distinct non-null contractors whose training score must be recomputed. */
  contractorIds: string[];
  /** True when the submission was already in the requested state. */
  idempotent: boolean;
}

/**
 * The only movements that exist. Everything else is a conflict, including
 * un-rejecting and re-verifying: a corrected certificate is a new submission,
 * not an edit of the refused one.
 */
const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ['verified', 'rejected'],
  verified: ['revoked'],
  rejected: [],
  revoked: [],
  // A document the expiry sweep has aged out is still evidence that was once
  // accepted, so discovering it was forged must still be actionable. Without
  // this, an expired certificate can never be revoked and never be deleted —
  // its binary is unreachable forever.
  expired: ['revoked'],
};

/** Verified and revoked evidence is immutable through delete. */
const UNDELETABLE: readonly string[] = ['verified', 'revoked'];

interface DocumentRow extends SqlRow {
  id: string;
  staff_id: string;
  document_type: string;
  verification_status: string;
  file_name: string | null;
}

interface LinkedRow extends SqlRow {
  id: string;
  contractor_id: string | null;
}

async function lockDocument(txn: TxnClient, documentId: string): Promise<DocumentRow> {
  const document = await txn.queryOne<DocumentRow>(
    `SELECT id, staff_id, document_type, verification_status, file_name
       FROM staff_documents
      WHERE id = $1
      FOR UPDATE`,
    [documentId]
  );
  if (!document) {
    throw new TrainingCertificateError('not_found', 'That certificate no longer exists');
  }
  return document;
}

function requireReason(transition: TrainingCertificateTransition): string | null {
  if (transition.status === 'verified') return null;
  const reason = transition.reason?.trim() ?? '';
  if (!reason) {
    throw new TrainingCertificateError(
      'invalid_input',
      `A reason is required to ${transition.status === 'rejected' ? 'reject' : 'revoke'} a certificate`
    );
  }
  return reason;
}

export async function transitionTrainingCertificate(
  txn: TxnClient,
  documentId: string,
  actor: TrainingCertificateActor,
  transition: TrainingCertificateTransition
): Promise<TrainingCertificateTransitionResult> {
  const document = await lockDocument(txn, documentId);
  const current = document.verification_status;

  if (current === transition.status) {
    // Already there. Returning success keeps a retried request harmless, while
    // `idempotent` lets the caller skip a duplicate audit entry.
    return {
      documentId: document.id,
      staffId: document.staff_id,
      status: transition.status,
      contractorIds: [],
      idempotent: true,
    };
  }

  if (!ALLOWED_TRANSITIONS[current]?.includes(transition.status)) {
    throw new TrainingCertificateError(
      'conflict',
      `A ${current} certificate cannot be marked ${transition.status}`
    );
  }

  const reason = requireReason(transition);

  const linked = await txn.query<LinkedRow>(
    `SELECT id, contractor_id
       FROM hs_worker_training
      WHERE staff_document_id = $1
      FOR UPDATE`,
    [documentId]
  );
  if (linked.length === 0) {
    // Nothing would become effective. Succeeding here would report a verified
    // certificate that satisfies no competency at all.
    throw new TrainingCertificateError(
      'conflict',
      'That certificate is not linked to any competency record'
    );
  }

  // One statement for every linked row, so they cannot diverge.
  //
  // Every use of $2 is cast to text. Without the casts Postgres deduces the
  // parameter's type twice — varchar from `verification_status = $2`, text from
  // `$2 = 'verified'` — and rejects the whole statement with 42P08
  // "inconsistent types deduced for parameter $2". It fails at execution, not
  // at compile time, and a stubbed TxnClient never sees it.
  await txn.query(
    `UPDATE hs_worker_training
        SET verification_status = $2::text,
            verified_by = CASE WHEN $2::text = 'verified' THEN $3::uuid ELSE verified_by END,
            verified_at = CASE WHEN $2::text = 'verified' THEN NOW() ELSE verified_at END,
            rejection_reason = CASE WHEN $2::text = 'rejected' THEN $4::text ELSE rejection_reason END,
            revoked_by = CASE WHEN $2::text = 'revoked' THEN $3::uuid ELSE revoked_by END,
            revoked_at = CASE WHEN $2::text = 'revoked' THEN NOW() ELSE revoked_at END,
            revocation_reason = CASE WHEN $2::text = 'revoked' THEN $4::text ELSE revocation_reason END,
            updated_at = NOW()
      WHERE staff_document_id = $1::uuid`,
    [documentId, transition.status, actor.userId, reason]
  );

  // staff_documents.verified_by references staff(id), not users(id): a user
  // with no staff row leaves it null while the training rows above still carry
  // the authenticated user id.
  await txn.query(
    `UPDATE staff_documents
        SET verification_status = $2::text,
            status = $2::text,
            verified_by = CASE WHEN $2::text = 'verified' THEN $3::uuid ELSE verified_by END,
            verified_at = CASE WHEN $2::text = 'verified' THEN NOW() ELSE verified_at END,
            verification_notes = COALESCE($4::text, verification_notes),
            updated_at = NOW()
      WHERE id = $1::uuid`,
    [documentId, transition.status, actor.staffId, reason]
  );

  const contractorIds = [
    ...new Set(linked.map((row) => row.contractor_id).filter((id): id is string => Boolean(id))),
  ];

  return {
    documentId: document.id,
    staffId: document.staff_id,
    status: transition.status,
    contractorIds,
    idempotent: false,
  };
}

/**
 * Delete a submission that never became evidence.
 *
 * The linked competencies go first: hs_worker_training.staff_document_id is
 * ON DELETE RESTRICT, so the document cannot be removed while they point at it.
 * Returns what the caller needs to delete the stored object after the commit.
 */
export async function deleteTrainingCertificateSubmission(
  txn: TxnClient,
  documentId: string
): Promise<{ staffId: string; fileName: string }> {
  const document = await lockDocument(txn, documentId);

  if (UNDELETABLE.includes(document.verification_status)) {
    throw new TrainingCertificateError(
      'immutable',
      `A ${document.verification_status} certificate cannot be deleted. Revoke it instead so the audit trail survives.`
    );
  }

  await txn.query(`DELETE FROM hs_worker_training WHERE staff_document_id = $1`, [documentId]);
  await txn.query(`DELETE FROM staff_documents WHERE id = $1`, [documentId]);

  return {
    staffId: document.staff_id,
    fileName: document.file_name ?? '',
  };
}

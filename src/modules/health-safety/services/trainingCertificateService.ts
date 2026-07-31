/**
 * Training-certificate domain service.
 *
 * One uploaded binary becomes one `staff_documents` certification row plus one
 * pending `hs_worker_training` row per selected competency, written inside a
 * caller-supplied transaction. The caller owns the transaction because it also
 * owns the VF Storage object: if this half fails, the route must delete the
 * uploaded file, and it can only know to do that if the failure reaches it.
 *
 * Nothing here touches storage, and nothing here logs a certificate number, a
 * storage path or a URL.
 */

import type { SqlRow, TxnClient } from '@/lib/db-pool';
import type { TrainingVerificationStatus } from '../types/training.types';
import {
  TrainingCertificateError,
  normalizeTrainingTypeIds,
  requireText,
  requireCalendarDate,
  optionalCalendarDate,
  requireUuid,
  resolveTrainingExpiry,
} from './trainingCertificateValidation';

export {
  TrainingCertificateError,
  resolveTrainingExpiry,
} from './trainingCertificateValidation';
export type { TrainingCertificateErrorCode } from './trainingCertificateValidation';
export type { TrainingVerificationStatus } from '../types/training.types';

// The lifecycle lives in its own module for the file-size limit; re-exported
// here so callers see one training-certificate service.
export {
  transitionTrainingCertificate,
  deleteTrainingCertificateSubmission,
} from './trainingCertificateLifecycle';
export type {
  TrainingCertificateTransition,
  TrainingCertificateActor,
  TrainingCertificateTransitionResult,
} from './trainingCertificateLifecycle';

export interface CreateTrainingCertificateInput {
  staffId: string;
  trainingTypeIds: string[];
  certificateNumber: string;
  provider: string;
  completedDate: string;
  explicitExpiryDate: string | null;
  fileName: string;
  filePath: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  actorUserId: string;
}

export interface TrainingCertificateSubmissionResult {
  documentId: string;
  trainingRecordIds: string[];
  verificationStatus: 'pending';
}

interface TrainingTypeRow extends SqlRow {
  id: string;
  code: string;
  validity_months: number | null;
}

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION;
}

/**
 * Create one certificate submission.
 *
 * Order matters: the employee row is locked first so two concurrent uploads for
 * the same person serialise on it, which is what makes the duplicate-certificate
 * check below meaningful rather than advisory.
 */
export async function createTrainingCertificateSubmission(
  txn: TxnClient,
  input: CreateTrainingCertificateInput
): Promise<TrainingCertificateSubmissionResult> {
  const trainingTypeIds = normalizeTrainingTypeIds(input.trainingTypeIds).map((id, i) =>
    requireUuid(id, `Training type ${i + 1}`)
  );
  const certificateNumber = requireText(input.certificateNumber, 'Certificate number', 100);
  const provider = requireText(input.provider, 'Provider', 255);
  const completedDate = requireCalendarDate(input.completedDate, 'Completion date');
  const explicitExpiryDate = optionalCalendarDate(input.explicitExpiryDate, 'Expiry date');

  requireUuid(input.staffId, 'Employee');

  const staff = await txn.queryOne<{ id: string; name: string | null }>(
    `SELECT id, name FROM staff WHERE id = $1 FOR UPDATE`,
    [input.staffId]
  );
  if (!staff) {
    throw new TrainingCertificateError('unknown_staff', 'That employee no longer exists');
  }

  const types = await txn.query<TrainingTypeRow>(
    `SELECT id, code, validity_months
       FROM hs_training_types
      WHERE id = ANY($1::uuid[]) AND is_active = true`,
    [trainingTypeIds]
  );
  if (types.length !== trainingTypeIds.length) {
    throw new TrainingCertificateError(
      'invalid_input',
      'One or more selected training types are unknown or no longer active'
    );
  }

  // Resolved before any write, so an unusable cadence or a backwards expiry
  // fails without leaving a half-written submission to roll back.
  const expiryByTypeId = new Map<string, string | null>(
    types.map((type) => [
      type.id,
      resolveTrainingExpiry(completedDate, explicitExpiryDate, type.validity_months),
    ])
  );

  const duplicate = await txn.queryOne<{ id: string }>(
    `SELECT id
       FROM staff_documents
      WHERE staff_id = $1
        AND document_type = 'certification'
        AND verification_status IN ('pending', 'verified')
        AND LOWER(BTRIM(document_number)) = LOWER(BTRIM($2))
        AND LOWER(BTRIM(issuing_authority)) = LOWER(BTRIM($3))
      LIMIT 1`,
    [input.staffId, certificateNumber, provider]
  );
  if (duplicate) {
    throw new TrainingCertificateError(
      'duplicate_certificate',
      'That certificate number is already recorded for this employee and provider'
    );
  }

  // The document's own expiry is the earliest competency expiry, so the HR
  // expiring-documents view flags it as soon as any competency it evidences
  // lapses. All-null (no competency expires) leaves the document with no expiry.
  const expiries = [...expiryByTypeId.values()].filter((d): d is string => d !== null);
  const documentExpiry = expiries.length ? expiries.sort()[0] : null;

  let document: { id: string } | null;
  try {
    document = await txn.queryOne<{ id: string }>(
      `INSERT INTO staff_documents (
         staff_id, document_type, document_name, file_url, file_path, file_name,
         file_size, mime_type, expiry_date, issued_date, issuing_authority,
         document_number, verification_status, status, uploaded_by, uploaded_at
       ) VALUES (
         $1, 'certification', $2, $3, $4, $5,
         $6, $7, $8, $9, $10,
         $11, 'pending', 'pending', $12, NOW()
       )
       RETURNING id`,
      [
        input.staffId,
        input.fileName,
        input.fileUrl,
        input.filePath,
        input.fileName,
        input.fileSize,
        input.mimeType,
        documentExpiry,
        completedDate,
        provider,
        certificateNumber,
        input.actorUserId,
      ]
    );
  } catch (error) {
    // The partial unique index is the real guarantee; the check above only buys
    // a clean message. A concurrent upload that slips between them lands here.
    if (isUniqueViolation(error)) {
      throw new TrainingCertificateError(
        'duplicate_certificate',
        'That certificate number is already recorded for this employee and provider'
      );
    }
    throw error;
  }

  if (!document) {
    throw new TrainingCertificateError('conflict', 'The certificate record could not be created');
  }

  const workerName = staff.name?.trim() || 'Unknown';
  const trainingRecordIds: string[] = [];

  for (const typeId of trainingTypeIds) {
    const row = await txn.queryOne<{ id: string }>(
      `INSERT INTO hs_worker_training (
         training_type_id, staff_id, worker_name, completed_date, expiry_date,
         certificate_number, issued_by, staff_document_id, verification_status, created_by
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, 'pending', $9
       )
       RETURNING id`,
      [
        typeId,
        input.staffId,
        workerName,
        completedDate,
        expiryByTypeId.get(typeId) ?? null,
        certificateNumber,
        provider,
        document.id,
        input.actorUserId,
      ]
    );
    if (!row) {
      throw new TrainingCertificateError('conflict', 'The competency record could not be created');
    }
    trainingRecordIds.push(row.id);
  }

  return {
    documentId: document.id,
    trainingRecordIds,
    verificationStatus: 'pending' satisfies TrainingVerificationStatus & 'pending',
  };
}

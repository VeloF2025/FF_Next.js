/**
 * Classified training certificate upload.
 * POST /api/staff-training-certificates-upload  (multipart/form-data)
 *
 * Fields: staffId, trainingTypeIds (repeated, comma-separated or JSON array),
 * certificateNumber, provider, completedDate, optional expiryDate, file.
 *
 * Flattened route name because nested dynamic API routes fail on this stack.
 *
 * The handler owns two resources that cannot commit together — a VF Storage
 * object and a database transaction — so the order is deliberate: authorize,
 * validate everything, and only then upload, because the cheapest compensation
 * for a rejected request is never having uploaded. If the transaction fails
 * afterwards, the object is deleted; if that delete also fails, the filename is
 * logged for an operator and withheld from the response.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import { readFile, unlink } from 'fs/promises';
import { withArcjetProtection, ajStrict } from '@/lib/arcjet';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { transaction } from '@/lib/db-pool';
import { canCreateTrainingCertificates } from '@/services/staff/staffAccessService';
import {
  uploadStaffDocument,
  deleteStaffDocument,
  isVFStorageAvailable,
} from '@/services/vfStorageAdapter';
import { logDocumentUploaded } from '@/services/staff/staffAuditService';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import {
  createTrainingCertificateSubmission,
  type TrainingCertificateSubmissionResult,
} from '@/modules/health-safety/services/trainingCertificateService';
import {
  // Imported from its definition site rather than the service's re-export, so
  // the instanceof below compares against the class the validators actually
  // throw even when the service module is substituted.
  TrainingCertificateError,
  MAX_CERTIFICATE_FILE_SIZE,
  assertValidCertificateFile,
  normalizeTrainingTypeIds,
  optionalCalendarDate,
  requireCalendarDate,
  requireText,
} from '@/modules/health-safety/services/trainingCertificateValidation';

const logger = createLogger('TrainingCertificateUploadAPI');

export const config = {
  api: { bodyParser: false, responseLimit: '10mb' },
};

const STATUS_BY_CODE: Record<string, number> = {
  invalid_input: 400,
  unknown_staff: 404,
  not_found: 404,
  duplicate_certificate: 409,
  conflict: 409,
  immutable: 409,
};

function first(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

function parseForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  return new Promise((resolve, reject) => {
    const form = formidable({ maxFileSize: MAX_CERTIFICATE_FILE_SIZE, keepExtensions: true });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }
  const authReq = req as AuthenticatedNextApiRequest;

  // Before the multipart body is even read: an unauthorized caller should never
  // reach storage, and this permission is not per-employee.
  if (!(await canCreateTrainingCertificates(authReq.user.id))) {
    return apiResponse.forbidden(res, 'You do not have permission to upload training certificates');
  }

  let temporaryFilePath: string | undefined;

  try {
    const { fields, files } = await parseForm(req);

    const staffId = requireText(first(fields.staffId), 'Employee', 64);
    const trainingTypeIds = normalizeTrainingTypeIds(
      Array.isArray(fields.trainingTypeIds) && fields.trainingTypeIds.length > 1
        ? fields.trainingTypeIds
        : first(fields.trainingTypeIds)
    );
    const certificateNumber = requireText(first(fields.certificateNumber), 'Certificate number', 100);
    const provider = requireText(first(fields.provider), 'Provider', 255);
    const completedDate = requireCalendarDate(first(fields.completedDate), 'Completion date');
    const explicitExpiryDate = optionalCalendarDate(first(fields.expiryDate), 'Expiry date');

    if (explicitExpiryDate && explicitExpiryDate < completedDate) {
      return apiResponse.badRequest(res, 'The expiry date cannot be before the completion date');
    }

    const uploaded = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!uploaded?.filepath) {
      return apiResponse.badRequest(res, 'A certificate file is required');
    }
    temporaryFilePath = uploaded.filepath;

    const fileName = uploaded.originalFilename ?? 'certificate';
    const fileBuffer = await readFile(uploaded.filepath);
    assertValidCertificateFile({
      fileName,
      mimeType: uploaded.mimetype ?? null,
      size: uploaded.size ?? fileBuffer.length,
      head: fileBuffer.subarray(0, 8),
    });

    // Checked before uploading so an unavailable store is a clean 503 rather
    // than a half-written submission.
    if (!(await isVFStorageAvailable())) {
      return apiResponse.error(
        res,
        ErrorCode.SERVICE_UNAVAILABLE,
        'Document storage is unavailable, so the certificate was not accepted'
      );
    }

    const stored = await uploadStaffDocument(staffId, fileBuffer, fileName, 'certification');

    let result: TrainingCertificateSubmissionResult;
    try {
      result = await transaction((txn) =>
        createTrainingCertificateSubmission(txn, {
          staffId,
          trainingTypeIds,
          certificateNumber,
          provider,
          completedDate,
          explicitExpiryDate,
          fileName: stored.filename,
          filePath: stored.path,
          fileUrl: stored.url,
          fileSize: stored.size,
          mimeType: uploaded.mimetype ?? 'application/octet-stream',
          actorUserId: authReq.user.id,
        })
      );
    } catch (error) {
      // Compensate: the object exists but nothing references it.
      const deleted = await deleteStaffDocument(staffId, stored.filename).catch(() => false);
      if (!deleted) {
        // The filename is what an operator needs to clean up by hand. It stays
        // in the server log and never reaches the response.
        logger.error('Orphaned training certificate requires cleanup', {
          staffId,
          fileName: stored.filename,
        });
      }
      throw error;
    }

    // After the commit only: an audit entry for a submission that rolled back
    // would be a record of something that never happened.
    await logDocumentUploaded(
      staffId,
      'certification',
      fileName,
      authReq.user.name || 'System',
      (req.headers['x-forwarded-for'] as string) || req.socket?.remoteAddress
    );
    await logHsActivity({
      activityType: 'training_certificate_submitted',
      entityType: 'hs_worker_training',
      entityId: result.trainingRecordIds[0] ?? null,
      description: 'Training certificate submitted for verification',
      metadata: {
        staffId,
        documentId: result.documentId,
        trainingTypeIds,
        trainingRecordIds: result.trainingRecordIds,
        verificationStatus: result.verificationStatus,
      },
      user: { id: authReq.user.id },
    });

    return apiResponse.created(res, result, 'Certificate submitted for verification');
  } catch (error) {
    if (error instanceof TrainingCertificateError) {
      const status = STATUS_BY_CODE[error.code] ?? 400;
      if (status === 409) return apiResponse.conflict(res, error.message);
      if (status === 404) return apiResponse.notFound(res, error.message);
      return apiResponse.badRequest(res, error.message);
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    if (/maxFileSize/i.test(message)) {
      return apiResponse.badRequest(res, 'The certificate file exceeds the 10 MB limit');
    }
    // Deliberately no certificate number, provider, path or URL.
    logger.error('Training certificate upload failed', { error: message });
    return res.status(500).json({ error: 'Failed to upload the training certificate' });
  } finally {
    if (temporaryFilePath) {
      await unlink(temporaryFilePath).catch(() => undefined);
    }
  }
}

export default withAuth(withArcjetProtection(handler, ajStrict));

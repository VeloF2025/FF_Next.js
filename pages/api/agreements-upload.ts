/**
 * Agreements Upload API
 * POST /api/agreements-upload
 *
 * Handles multipart upload of a signed agreement PDF to VF Storage,
 * then creates the corresponding record in contractor_agreements.
 *
 * Storage path convention:
 *   agreements/documents/{project_id}_{timestamp}_{sanitized_filename}
 *
 * Reference number format:
 *   {TYPE}/{YYYY}/{PROJECT_SHORT_ID}
 *   e.g. SOW/2026/418320307
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import formidable from 'formidable';
import fs from 'fs';
import { log } from '@/lib/logger';
import { vfStorage } from '@/services/vfStorageAdapter';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';

// ⚪ UNTESTED: live upload flow — unit-tested logic paths only
const sql = neon(process.env.DATABASE_URL!);

/** PDF magic bytes prefix (hex) */
const PDF_MAGIC = '25504446';

/** Disable body parser — multipart is parsed by formidable */
export const config = {
  api: {
    bodyParser: false,
    responseLimit: '25mb',
  },
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const authReq = req as AuthenticatedNextApiRequest;
  const createdBy = authReq.user?.email ?? authReq.user?.id ?? 'system';

  let tempFilePath: string | null = null;
  let uploadedStoragePath: string | null = null;

  try {
    // ------------------------------------------------------------------
    // 1. Parse multipart form
    // ------------------------------------------------------------------
    const { fields, files } = await parseForm(req);

    const project_id     = firstField(fields.project_id);
    const contractor_id  = firstField(fields.contractor_id);
    const agreement_type = firstField(fields.agreement_type) as 'sow' | 'mba' | undefined;
    const effective_date = firstField(fields.effective_date);
    const expiry_date    = firstField(fields.expiry_date);
    const total_value    = firstField(fields.total_value) ?? '0';
    const status         = firstField(fields.status) ?? 'draft';

    // ------------------------------------------------------------------
    // 2. Validate required fields
    // ------------------------------------------------------------------
    if (!project_id) {
      return apiResponse.badRequest(res, 'Missing required field: project_id');
    }
    if (!contractor_id) {
      return apiResponse.badRequest(res, 'Missing required field: contractor_id');
    }
    if (!agreement_type || !['sow', 'mba'].includes(agreement_type)) {
      return apiResponse.badRequest(res, 'Missing or invalid field: agreement_type (must be "sow" or "mba")');
    }
    if (!effective_date) {
      return apiResponse.badRequest(res, 'Missing required field: effective_date');
    }
    if (!expiry_date) {
      return apiResponse.badRequest(res, 'Missing required field: expiry_date');
    }

    const validStatuses = ['draft', 'pending_review', 'sent', 'signed', 'active', 'expired', 'terminated'];
    if (!validStatuses.includes(status)) {
      return apiResponse.badRequest(res, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    // ------------------------------------------------------------------
    // 3. Validate uploaded file
    // ------------------------------------------------------------------
    const fileArray = Array.isArray(files.file) ? files.file : [files.file];
    const file = fileArray[0];

    if (!file) {
      return apiResponse.badRequest(res, 'No file uploaded (field name: "file")');
    }

    tempFilePath = file.filepath;

    if (file.mimetype !== 'application/pdf') {
      return apiResponse.badRequest(res, 'Only PDF files are accepted for agreements');
    }

    const maxSize = 25 * 1024 * 1024; // 25 MB
    if (file.size > maxSize) {
      return apiResponse.badRequest(res, 'File too large. Maximum size is 25 MB');
    }

    // ------------------------------------------------------------------
    // 4. Verify PDF magic bytes
    // ------------------------------------------------------------------
    const fileBuffer = await fs.promises.readFile(file.filepath);
    const hex = fileBuffer.subarray(0, 4).toString('hex').toUpperCase();

    if (!hex.startsWith(PDF_MAGIC)) {
      await cleanupTemp(tempFilePath);
      tempFilePath = null;
      return apiResponse.badRequest(res, 'File content does not appear to be a valid PDF');
    }

    // ------------------------------------------------------------------
    // 5. Upload to VF Storage
    // ------------------------------------------------------------------
    const sanitizedName  = sanitizeFileName(file.originalFilename ?? 'agreement.pdf');
    const uniqueFilename = `${project_id}_${Date.now()}_${sanitizedName}`;

    const uploadResult = await vfStorage.uploadFile(
      fileBuffer,
      'agreements',
      'documents',
      uniqueFilename
    );

    uploadedStoragePath = uploadResult.path;
    const documentUrl   = uploadResult.url;

    // ------------------------------------------------------------------
    // 6. Generate reference number
    // ------------------------------------------------------------------
    const year           = new Date().getFullYear();
    const projectShort   = project_id.replace(/-/g, '').substring(0, 8).toUpperCase();
    const typePrefix     = agreement_type.toUpperCase(); // SOW | MBA
    const referenceNumber = `${typePrefix}/${year}/${projectShort}`;

    // ------------------------------------------------------------------
    // 7. Insert record into contractor_agreements
    // ------------------------------------------------------------------
    const rows = await sql`
      INSERT INTO contractor_agreements (
        project_id,
        contractor_id,
        agreement_type,
        status,
        draft_document_url,
        effective_date,
        expiry_date,
        created_by,
        created_at,
        updated_at
      ) VALUES (
        ${project_id}::uuid,
        ${contractor_id}::uuid,
        ${agreement_type},
        ${status},
        ${documentUrl},
        ${effective_date}::date,
        ${expiry_date}::date,
        ${createdBy},
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    const agreement = rows[0];
    if (!agreement) {
      throw new Error('Database insert returned no rows');
    }

    // ------------------------------------------------------------------
    // 8. Cleanup temp file
    // ------------------------------------------------------------------
    await cleanupTemp(tempFilePath);
    tempFilePath = null;

    log.info('AgreementsUpload', {
      action: 'created',
      agreementId: agreement.id,
      project_id,
      contractor_id,
      agreement_type,
      referenceNumber,
      createdBy,
    });

    return apiResponse.created(res, {
      ...agreement,
      reference_number: referenceNumber,
      total_value: parseFloat(total_value) || 0,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    log.error('AgreementsUpload', { action: 'upload', error, message });

    // Compensating transaction: remove VF Storage file if DB insert failed
    if (uploadedStoragePath) {
      try {
        const parts    = uploadedStoragePath.split('/');
        const filename = parts[parts.length - 1] ?? '';
        if (filename) {
          await vfStorage.deleteFile('agreements', 'documents', filename);
        }
        log.info('AgreementsUpload', { action: 'storageRollback', path: uploadedStoragePath });
      } catch (cleanupError: unknown) {
        log.error('AgreementsUpload', {
          action: 'storageRollbackFailed',
          path: uploadedStoragePath,
          error: cleanupError,
        });
      }
    }

    if (tempFilePath) {
      await cleanupTemp(tempFilePath);
    }

    return apiResponse.internalError(res, error as Error);
  }
}

export default withAuth(handler);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse multipart form data — max file size 25 MB */
function parseForm(
  req: NextApiRequest
): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: 25 * 1024 * 1024,
      keepExtensions: true,
    });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

/** Extract first value from a formidable field (handles string | string[]) */
function firstField(
  value: string | string[] | undefined
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Strip unsafe characters from a filename while preserving extension */
function sanitizeFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  const name    = lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
  const ext     = lastDot > 0 ? fileName.substring(lastDot) : '';

  const safe = name
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 100);

  return safe + ext;
}

/** Remove a temporary file, swallowing errors */
async function cleanupTemp(filePath: string): Promise<void> {
  await fs.promises
    .unlink(filePath)
    .catch((e: unknown) =>
      log.debug('AgreementsUpload', {
        action: 'cleanupTemp',
        filePath,
        error: e instanceof Error ? e.message : 'unknown',
      })
    );
}

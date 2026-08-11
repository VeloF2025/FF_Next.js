/**
 * H&S attachments — upload and list.
 *
 * POST /api/health-safety/attachments   (multipart/form-data)
 *   Fields: surface, parentId, file
 * GET  /api/health-safety/attachments?surface=medical&parentId=<uuid>
 *
 * The handler owns two resources that cannot commit together — a VF Storage
 * object and a database row — so the order is deliberate: authorize, validate
 * everything, and only then upload, because the cheapest compensation for a
 * rejected request is never having uploaded. If the insert fails afterwards the
 * object is deleted; if that delete also fails, the path is logged for an
 * operator and withheld from the response.
 *
 * Bytes land under the `hs-private` storage type, which nginx refuses. They are
 * readable only through ./download, which re-checks permission per request.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import { readFile, unlink } from 'fs/promises';
import { withArcjetProtection, ajStrict } from '@/lib/arcjet';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { vfStorage, isVFStorageAvailable } from '@/services/vfStorageAdapter';
import { withHsPermission } from '@/modules/health-safety/services/hsAuth';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import { storageLocation, surfaceConfig } from '@/modules/health-safety/services/hsAttachmentPolicy';
import {
  insertAttachment,
  listAttachments,
} from '@/modules/health-safety/services/hsAttachmentService';
import {
  HsAttachmentError,
  MAX_ATTACHMENT_FILE_SIZE,
  assertValidAttachmentFile,
  requireAttachmentSurface,
  requireUuid,
} from '@/modules/health-safety/services/hsAttachmentValidation';

const logger = createLogger('HsAttachmentsAPI');

export const config = {
  api: { bodyParser: false, responseLimit: '10mb' },
};

const STATUS_BY_CODE: Record<string, number> = {
  invalid_input: 400,
  not_found: 404,
  unavailable: 503,
};

function first(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

function parseForm(
  req: NextApiRequest
): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  return new Promise((resolve, reject) => {
    const form = formidable({ maxFileSize: MAX_ATTACHMENT_FILE_SIZE, keepExtensions: true });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

async function handleList(req: NextApiRequest, res: NextApiResponse) {
  const surface = requireAttachmentSurface(first(req.query.surface));
  const parentId = requireUuid(first(req.query.parentId), 'Record');

  const attachments = await listAttachments(surface, parentId);
  return apiResponse.success(res, attachments);
}

async function handleUpload(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthenticatedNextApiRequest;
  let temporaryFilePath: string | undefined;

  try {
    const { fields, files } = await parseForm(req);

    const surface = requireAttachmentSurface(first(fields.surface));
    const parentId = requireUuid(first(fields.parentId), 'Record');

    const uploaded = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!uploaded?.filepath) {
      return apiResponse.badRequest(res, 'A file is required');
    }
    temporaryFilePath = uploaded.filepath;

    const fileName = uploaded.originalFilename ?? 'attachment';
    const fileBuffer = await readFile(uploaded.filepath);
    assertValidAttachmentFile({
      fileName,
      mimeType: uploaded.mimetype ?? null,
      size: uploaded.size ?? fileBuffer.length,
      head: fileBuffer.subarray(0, 8),
    });

    // Checked before uploading so an unavailable store is a clean 503 rather
    // than a half-written record.
    if (!(await isVFStorageAvailable())) {
      return apiResponse.error(
        res,
        ErrorCode.SERVICE_UNAVAILABLE,
        'Document storage is unavailable, so the file was not accepted'
      );
    }

    const { type, category } = storageLocation(surface);
    const stored = await vfStorage.uploadFile(fileBuffer, type, category, fileName);

    let attachment;
    try {
      attachment = await insertAttachment({
        surface,
        parentId,
        filePath: stored.path,
        fileName,
        fileSize: stored.size || fileBuffer.length,
        mimeType: uploaded.mimetype ?? 'application/octet-stream',
        uploadedBy: authReq.user.id,
      });
    } catch (error) {
      // Compensate: the object exists but nothing references it.
      const deleted = await vfStorage
        .deleteFile(type, category, stored.filename)
        .catch(() => false);
      if (!deleted) {
        // The path is what an operator needs to clean up by hand. It stays in
        // the server log and never reaches the response.
        logger.error('Orphaned H&S attachment requires cleanup', {
          surface,
          filePath: stored.path,
        });
      }
      throw error;
    }

    // After the insert only: an audit entry for an upload that rolled back
    // would be a record of something that never happened.
    await logHsActivity({
      activityType: 'attachment_uploaded',
      entityType: surfaceConfig(surface).parentTable,
      entityId: parentId,
      description: `Document attached to ${surfaceConfig(surface).label}`,
      metadata: {
        attachmentId: attachment.id,
        surface,
        fileName,
        fileSize: attachment.file_size,
      },
      user: { id: authReq.user.id },
    });

    return apiResponse.created(res, attachment, 'File uploaded');
  } finally {
    if (temporaryFilePath) {
      await unlink(temporaryFilePath).catch(() => undefined);
    }
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') return await handleList(req, res);
    if (req.method === 'POST') return await handleUpload(req, res);
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
  } catch (error) {
    if (error instanceof HsAttachmentError) {
      const status = STATUS_BY_CODE[error.code] ?? 400;
      // apiResponse.notFound(res, resource) renders "<resource> not found", so
      // passing a complete sentence through it yields "…no longer exists not
      // found". These messages are already sentences; send them verbatim.
      if (status === 404) return apiResponse.error(res, ErrorCode.NOT_FOUND, error.message);
      if (status === 503) {
        return apiResponse.error(res, ErrorCode.SERVICE_UNAVAILABLE, error.message);
      }
      return apiResponse.badRequest(res, error.message);
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    if (/maxFileSize/i.test(message)) {
      return apiResponse.badRequest(res, 'The file exceeds the 10 MB limit');
    }
    // Deliberately no storage path, filename or record id in the client-facing
    // message; internalError withholds detail outside development and logs the
    // error server-side.
    logger.error('H&S attachment request failed', { method: req.method, error: message });
    return apiResponse.internalError(res, error, 'Failed to process the attachment');
  }
}

export default withHsPermission(withArcjetProtection(handler, ajStrict));

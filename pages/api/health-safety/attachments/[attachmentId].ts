/**
 * H&S attachment delete.
 * DELETE /api/health-safety/attachments/[attachmentId]
 *
 * The row is deleted first and the object second. A failure between them leaves
 * an unreferenced file, which an operator can sweep; the opposite order would
 * leave a row pointing at bytes that no longer exist, which users would meet as
 * a download that fails forever.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withArcjetProtection, ajStrict } from '@/lib/arcjet';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { vfStorage } from '@/services/vfStorageAdapter';
import { withHsPermission } from '@/modules/health-safety/services/hsAuth';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import {
  isPrivateStoragePath,
  storageLocation,
  surfaceConfig,
} from '@/modules/health-safety/services/hsAttachmentPolicy';
import {
  getAttachment,
  deleteAttachmentRow,
} from '@/modules/health-safety/services/hsAttachmentService';
import {
  HsAttachmentError,
  requireUuid,
} from '@/modules/health-safety/services/hsAttachmentValidation';

const logger = createLogger('HsAttachmentDeleteAPI');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return apiResponse.methodNotAllowed(res, req.method!, ['DELETE']);
  }

  const authReq = req as AuthenticatedNextApiRequest;
  const attachmentId = requireUuid(
    Array.isArray(req.query.attachmentId) ? req.query.attachmentId[0] : req.query.attachmentId,
    'Attachment'
  );

  const attachment = await getAttachment(attachmentId);
  if (!attachment) {
    return apiResponse.notFound(res, 'Attachment', attachmentId);
  }

  // Same check the download route makes, for the same reason: this path is
  // about to be turned into a storage URL. A row pointing outside the private
  // prefix is not ours to act on, and deleting by an unvalidated path could
  // remove an object in an unrelated directory.
  if (!isPrivateStoragePath(attachment.file_path)) {
    logger.error('Attachment path is outside the private prefix', { attachmentId });
    return apiResponse.notFound(res, 'Attachment', attachmentId);
  }

  const removed = await deleteAttachmentRow(attachmentId);
  if (!removed) {
    // Lost a race with a concurrent delete. The other caller owns the object.
    return apiResponse.notFound(res, 'Attachment', attachmentId);
  }

  const { type, category } = storageLocation(attachment.surface);
  // Encoded at the call site: vfStorageAdapter.deleteFile interpolates the
  // filename into a URL path without escaping it.
  const filename = encodeURIComponent(attachment.file_path.split('/').pop() ?? '');
  const objectDeleted = await vfStorage.deleteFile(type, category, filename).catch(() => false);
  if (!objectDeleted) {
    // The row is already gone, so the file is unreachable through the app. It
    // still occupies storage, and the path is what an operator needs to sweep
    // it — logged, never returned.
    logger.error('Attachment row deleted but its object remains', {
      attachmentId,
      filePath: attachment.file_path,
    });
  }

  await logHsActivity({
    activityType: 'attachment_deleted',
    entityType: surfaceConfig(attachment.surface).parentTable,
    entityId: attachment.parent_id,
    description: `Document removed from ${surfaceConfig(attachment.surface).label}`,
    metadata: {
      attachmentId,
      surface: attachment.surface,
      fileName: attachment.file_name,
      objectDeleted,
    },
    user: { id: authReq.user.id },
  });

  return apiResponse.success(res, { id: attachmentId }, 'Attachment removed');
}

async function guarded(req: NextApiRequest, res: NextApiResponse) {
  try {
    return await handler(req, res);
  } catch (error) {
    if (error instanceof HsAttachmentError) {
      // Sent verbatim: apiResponse.notFound appends "not found" to whatever it
      // is given, and these messages are already complete sentences.
      if (error.code === 'not_found') return apiResponse.error(res, ErrorCode.NOT_FOUND, error.message);
      return apiResponse.badRequest(res, error.message);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Attachment delete failed', { error: message });
    return apiResponse.internalError(res, error, 'Failed to remove the attachment');
  }
}

export default withHsPermission(withArcjetProtection(guarded, ajStrict));

/**
 * H&S attachment download.
 * GET /api/health-safety/attachments/download?id=<uuid>[&inline=true]
 *
 * The only way to read an H&S attachment. The bytes sit under the `hs-private`
 * storage prefix, which nginx refuses, so every read passes through here and is
 * permission-checked on each request rather than once at upload — a URL handed
 * to someone who later loses access stops working.
 *
 * `withHsPermission` maps GET to the 'view' action, so this is exactly as
 * restricted as reading the record the file hangs off.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { withHsPermission } from '@/modules/health-safety/services/hsAuth';
import { isPrivateStoragePath } from '@/modules/health-safety/services/hsAttachmentPolicy';
import { getAttachment } from '@/modules/health-safety/services/hsAttachmentService';
import {
  HsAttachmentError,
  requireUuid,
} from '@/modules/health-safety/services/hsAttachmentValidation';

const logger = createLogger('HsAttachmentDownloadAPI');

const VF_STORAGE_URL = process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';

/**
 * Rendered in the browser tab only for formats that cannot carry script in a
 * way the sandbox below does not already contain. Everything else downloads.
 */
const INLINE_SAFE_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const attachmentId = requireUuid(
    Array.isArray(req.query.id) ? req.query.id[0] : req.query.id,
    'Attachment'
  );

  const attachment = await getAttachment(attachmentId);
  if (!attachment) {
    return apiResponse.notFound(res, 'Attachment', attachmentId);
  }

  // A row pointing outside the private prefix predates this design or was
  // written by something that bypassed it. Serving it would hand out bytes
  // nginx is not guarding, so it is refused rather than proxied.
  if (!isPrivateStoragePath(attachment.file_path)) {
    logger.error('Attachment path is outside the private prefix', { attachmentId });
    return apiResponse.notFound(res, 'Attachment', attachmentId);
  }

  const response = await fetch(`${VF_STORAGE_URL}/${attachment.file_path}`);
  if (!response.ok) {
    // The storage path is deliberately not logged: a medical certificate's
    // location must not be recoverable from application logs.
    logger.error('Storage fetch failed', { attachmentId, status: response.status });
    return res.status(502).json({ error: 'Failed to fetch the file from storage' });
  }

  const fileBuffer = Buffer.from(await response.arrayBuffer());

  const wantsInline = req.query.inline === 'true' && INLINE_SAFE_TYPES.has(attachment.mime_type);
  const disposition = wantsInline ? 'inline' : 'attachment';

  res.setHeader('Content-Type', attachment.mime_type);
  res.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${encodeURIComponent(attachment.file_name)}"`
  );
  res.setHeader('Content-Length', fileBuffer.byteLength);
  // A PDF rendered inline runs in this origin unless it is sandboxed, and
  // nosniff stops a mislabelled file being re-interpreted as something
  // scriptable.
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Private, and short: the permission is re-checked per request, so a long
  // cache would keep serving a file to someone whose access has been removed.
  res.setHeader('Cache-Control', 'private, no-store');

  return res.send(fileBuffer);
}

async function guarded(req: NextApiRequest, res: NextApiResponse) {
  try {
    return await handler(req, res);
  } catch (error) {
    if (error instanceof HsAttachmentError) {
      if (error.code === 'not_found') return apiResponse.notFound(res, error.message);
      return apiResponse.badRequest(res, error.message);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Attachment download failed', { error: message });
    return res.status(500).json({ error: 'Failed to download the attachment' });
  }
}

export default withHsPermission(withArcjetProtection(guarded, aj));

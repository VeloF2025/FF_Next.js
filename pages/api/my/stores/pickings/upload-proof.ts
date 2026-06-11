/**
 * POST /api/my/stores/pickings/upload-proof — upload the mandatory proof
 * photo for a NON-SERIAL stock issue, BEFORE the picking is created.
 *
 * Upload-first sequencing: client uploads here, gets { photoKey, photoUrl },
 * then includes them in POST /api/my/stores/pickings. The picking create
 * rejects non-serial issues without a proofPhotoKey (_create.ts).
 *
 * Storage: VF Storage /upload/stores/picking-proof, filename
 * <staffId>__<uuid>.jpg. Orphaned blobs (upload then abandoned flow) are
 * accepted in v1 — same trade-off as receipts extract.
 *
 * Gated to stores roles via requireStoresActor (withMySession tier).
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import formidable from 'formidable';
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireStoresActor } from '@/modules/field-stock-pwa/lib/storesActor';
import { vfStorage } from '@/services/vfStorageAdapter';

export const config = { api: { bodyParser: false } };

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

function isRealImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return true; // WebP
  return false;
}

function parseMultipart(
  req: NextApiRequest
): Promise<{ files: formidable.Files }> {
  const form = formidable({ multiples: false, maxFileSize: MAX_FILE_BYTES, keepExtensions: true });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, _fields, files) => (err ? reject(err) : resolve({ files })));
  });
}

function pickFirst<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const actor = await requireStoresActor(res, session.staffId);
  if (!actor) return;

  let parsed: { files: formidable.Files };
  try {
    parsed = await parseMultipart(req);
  } catch (err) {
    log.error('upload-proof multipart parse failed', { err }, 'my/stores/upload-proof');
    return apiResponse.badRequest(res, 'Could not read upload — file too large or malformed.');
  }

  const file = pickFirst(parsed.files.photo) as formidable.File | undefined;
  if (!file) return apiResponse.badRequest(res, 'Photo is required (form field "photo").');

  const mime = file.mimetype ?? 'application/octet-stream';
  if (!ALLOWED_MIME.has(mime)) {
    fs.unlink(file.filepath).catch(() => undefined);
    return apiResponse.badRequest(res, `Unsupported file type: ${mime}`);
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(file.filepath);
  } catch (err) {
    log.error('upload-proof temp read failed', { err }, 'my/stores/upload-proof');
    return apiResponse.internalError(res, err);
  } finally {
    fs.unlink(file.filepath).catch(() => undefined);
  }

  if (!isRealImage(buffer)) {
    return apiResponse.badRequest(res, 'File content is not a valid image.');
  }

  try {
    const filename = `${actor.staffId}__${crypto.randomUUID()}.jpg`;
    const uploaded = await vfStorage.uploadFile(buffer, 'stores', 'picking-proof', filename);
    return apiResponse.success(res, {
      photoKey: `stores/picking-proof/${filename}`,
      photoUrl: uploaded.url,
    });
  } catch (err) {
    log.error('upload-proof storage upload failed', { err, staffId: actor.staffId }, 'my/stores/upload-proof');
    return apiResponse.internalError(res, err);
  }
});

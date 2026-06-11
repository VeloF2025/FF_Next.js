/**
 * POST /api/my/stores/serials/extract — photo→serial fallback for the
 * stores issue flow. Multipart field "photo".
 *
 * Pipeline (_extractCore.ts): zxing-wasm decode on the ORIGINAL image →
 * Qwen3-VL on a 1024x768 resize → validated candidate. The photo is stored
 * to VF Storage stores/serial-scans/ regardless of outcome (failed
 * extractions stay diagnosable and become VLM training material).
 *
 * Response data: { serial, family, method: 'barcode'|'vlm'|'none',
 *                  confidence, photoUrl }
 * The client PRE-FILLS the manual-entry field — the user always confirms
 * before the serial enters the validateSerial funnel.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import formidable from 'formidable';
import sharp from 'sharp';
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireStoresActor } from '@/modules/field-stock-pwa/lib/storesActor';
import { vfStorage } from '@/services/vfStorageAdapter';
import {
  decodeSerialFromImage,
  extractSerialWithVlm,
  validateSerialCandidate,
} from './_extractCore';

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

function parseMultipart(req: NextApiRequest): Promise<{ files: formidable.Files }> {
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
    log.error('serial extract multipart parse failed', { err }, 'my/stores/serials/extract');
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
    log.error('serial extract temp read failed', { err }, 'my/stores/serials/extract');
    return apiResponse.internalError(res, err);
  } finally {
    fs.unlink(file.filepath).catch(() => undefined);
  }

  if (!isRealImage(buffer)) {
    return apiResponse.badRequest(res, 'File content is not a valid image.');
  }

  // Store the photo first (evidence + training data), best-effort.
  let photoUrl: string | null = null;
  try {
    const filename = `${actor.staffId}__${crypto.randomUUID()}.jpg`;
    const uploaded = await vfStorage.uploadFile(buffer, 'stores', 'serial-scans', filename);
    photoUrl = uploaded.url;
  } catch (err) {
    log.warn('serial extract: photo storage failed (continuing)', { err }, 'my/stores/serials/extract');
  }

  try {
    // 1. Barcode pass on the ORIGINAL image.
    const decoded = await decodeSerialFromImage(buffer);
    const decodedValid = decoded ? validateSerialCandidate(decoded) : null;
    if (decodedValid) {
      log.info('serial extract: barcode hit', { family: decodedValid.family }, 'my/stores/serials/extract');
      return apiResponse.success(res, {
        serial: decodedValid.serial, family: decodedValid.family,
        method: 'barcode', confidence: 1, photoUrl,
      });
    }

    // 2. VLM pass on a 1024x768 resize (EXIF-rotated).
    const resized = await sharp(buffer)
      .rotate()
      .resize(1024, 768, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const vlm = await extractSerialWithVlm(resized);
    if (vlm) {
      log.info('serial extract: VLM hit', { family: vlm.family, confidence: vlm.confidence }, 'my/stores/serials/extract');
      return apiResponse.success(res, { ...vlm, method: 'vlm', photoUrl });
    }

    log.info('serial extract: no serial found', { staffId: actor.staffId }, 'my/stores/serials/extract');
    return apiResponse.success(res, { serial: null, family: null, method: 'none', confidence: 0, photoUrl });
  } catch (err) {
    log.error('serial extract failed', { err }, 'my/stores/serials/extract');
    return apiResponse.internalError(res, err);
  }
});

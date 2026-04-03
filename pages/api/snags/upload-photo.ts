/**
 * Snag Photo Upload API
 * POST /api/snags/upload-photo
 *
 * Accepts multipart form with: file (image), snag_id, phase.
 * Uploads file to VF Storage at snags/tqr-photos bucket,
 * then creates a snag_photos record.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { SnagPhoto } from '@/modules/construction-qa/types/snag.types';

export const config = {
  api: {
    bodyParser: false,
  },
};

const sql = neon(process.env.DATABASE_URL!);
const VF_STORAGE_URL = process.env.VF_STORAGE_URL ?? 'http://100.96.203.105:8091';
const STORAGE_PUBLIC_BASE = 'https://vf.fibreflow.app/storage';

/** Upload image buffer to VF Storage, return the public URL */
async function uploadToVfStorage(
  fileBuffer: Buffer,
  filename: string
): Promise<string> {
  const formData = new FormData();
  formData.append('file', fileBuffer, {
    filename,
    contentType: 'image/jpeg',
  });

  const uploadUrl = `${VF_STORAGE_URL}/upload/snags/tqr-photos`;
  log.info('SnagUpload: uploading to VF Storage', { uploadUrl, filename });

  const response = await axios.post<{ path: string }>(uploadUrl, formData, {
    headers: formData.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  const { path: storagePath } = response.data;
  const publicUrl = `${STORAGE_PUBLIC_BASE}/${storagePath}`;
  log.info('SnagUpload: VF Storage upload complete', { storagePath, publicUrl });
  return publicUrl;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['POST']);
  }

  // Parse multipart form
  const form = formidable({ maxFileSize: 20 * 1024 * 1024, keepExtensions: true });
  let fields: formidable.Fields;
  let files: formidable.Files;

  try {
    [fields, files] = await form.parse(req);
  } catch (err) {
    log.error('SnagUpload: failed to parse form', { err });
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Failed to parse multipart form');
  }

  const snagId = Array.isArray(fields.snag_id) ? fields.snag_id[0] : fields.snag_id;
  const phase = Array.isArray(fields.phase) ? fields.phase[0] : fields.phase;
  const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;

  if (!snagId) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'snag_id is required');
  }
  if (!phase || !['before', 'during', 'after'].includes(phase)) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'phase must be before, during, or after');
  }
  if (!uploadedFile) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'No file uploaded (field name: file)');
  }

  // Verify snag exists
  const snagCheck = await sql`SELECT id FROM snags WHERE id = ${snagId}`;
  if (snagCheck.length === 0) {
    return apiResponse.notFound(res, 'Snag', snagId);
  }

  try {
    const fileBuffer = fs.readFileSync(uploadedFile.filepath);
    const ext = path.extname(uploadedFile.originalFilename ?? '.jpg') || '.jpg';
    const safeFilename = `${snagId}-${phase}-${Date.now()}${ext}`;

    const photoUrl = await uploadToVfStorage(fileBuffer, safeFilename);

    const rows = await sql`
      INSERT INTO snag_photos (snag_id, phase, photo_url, source)
      VALUES (${snagId}, ${phase}, ${photoUrl}, 'manual')
      ON CONFLICT (snag_id, phase, photo_url) DO UPDATE
        SET source = EXCLUDED.source
      RETURNING *
    ` as SnagPhoto[];

    if (!rows[0]) {
      return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to create photo record');
    }

    log.info('SnagUpload: photo record created', { snagId, phase, photoUrl });
    return apiResponse.created(res, rows[0]);
  } catch (err) {
    log.error('SnagUpload: upload or DB error', { err, snagId, phase });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);

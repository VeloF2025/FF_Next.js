/**
 * Snag Photo Upload API
 *
 * POST /api/snags/upload-photo
 *
 * Accepts a multipart upload with:
 *   - file     — image file
 *   - snag_id  — UUID of the snag
 *   - phase    — 'during' | 'after'
 *
 * Uploads to VF Storage, inserts a snag_photo record, returns it.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import formidable from 'formidable';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, getAuthUser } from '@/lib/auth';
import type { SnagPhoto } from '@/modules/construction-qa/types/snag.types';

export const config = {
  api: {
    bodyParser: false,
  },
};

const sql = neon(process.env.DATABASE_URL!);

const VALID_PHASES = ['during', 'after'] as const;
type UploadPhase = typeof VALID_PHASES[number];

// ============================================================
// VF Storage upload helper
// ============================================================

async function uploadToVfStorage(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  const VF_STORAGE_BASE = process.env.VF_STORAGE_URL ?? 'http://100.96.203.105:8091';

  const formData = new FormData();
  formData.append(
    'file',
    new Blob([buffer as unknown as BlobPart], { type: mimeType }),
    filename
  );

  const response = await fetch(`${VF_STORAGE_BASE}/upload/snags/tqr-photos`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`VF Storage upload failed (${response.status}): ${text}`);
  }

  const result = (await response.json()) as { path?: string; filename?: string };
  const storagePath = result.path ?? `snags/tqr-photos/${result.filename ?? filename}`;
  return `https://vf.fibreflow.app/storage/${storagePath}`;
}

// ============================================================
// Handler
// ============================================================

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['POST']);
  }

  const user = getAuthUser(req);

  try {
    // ── 1. Parse multipart form ──────────────────────────────
    const form = formidable({ maxFileSize: 20 * 1024 * 1024, keepExtensions: true });
    const [fields, files] = await form.parse(req);

    const snagId = Array.isArray(fields.snag_id) ? fields.snag_id[0] : fields.snag_id;
    const phase = Array.isArray(fields.phase) ? fields.phase[0] : fields.phase;

    if (!snagId) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'snag_id is required');
    }
    if (!phase || !VALID_PHASES.includes(phase as UploadPhase)) {
      return apiResponse.error(
        res,
        ErrorCode.BAD_REQUEST,
        `phase must be one of: ${VALID_PHASES.join(', ')}`
      );
    }

    const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!uploadedFile) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'No file uploaded (field name: file)');
    }

    // ── 2. Validate snag exists ──────────────────────────────
    const snagCheck = await sql`
      SELECT id FROM snags WHERE id = ${snagId}
    ` as Array<{ id: string }>;

    if (snagCheck.length === 0) {
      return apiResponse.notFound(res, 'Snag', snagId);
    }

    // ── 3. Read file and upload to VF Storage ────────────────
    const buffer = fs.readFileSync(uploadedFile.filepath);
    const originalName = uploadedFile.originalFilename ?? `photo-${Date.now()}.jpg`;
    const mimeType = uploadedFile.mimetype ?? 'image/jpeg';

    const photoUrl = await uploadToVfStorage(buffer, originalName, mimeType);

    log.info('SnagPhotoUpload: file uploaded to VF Storage', {
      snagId,
      phase,
      filename: originalName,
      url: photoUrl,
    });

    // ── 4. Insert snag_photo record ──────────────────────────
    const rows = await sql`
      INSERT INTO snag_photos (
        snag_id, phase, photo_url, source, uploaded_by
      ) VALUES (
        ${snagId},
        ${phase},
        ${photoUrl},
        'manual',
        ${user?.id ?? null}
      )
      ON CONFLICT (snag_id, phase, photo_url) DO UPDATE
        SET uploaded_by = EXCLUDED.uploaded_by
      RETURNING *
    ` as SnagPhoto[];

    if (!rows[0]) {
      return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to insert photo record');
    }

    log.info('SnagPhotoUpload: record created', { photoId: rows[0].id, snagId, phase });
    return apiResponse.created(res, rows[0]);

  } catch (error) {
    log.error('SnagPhotoUpload: upload failed', { error });
    return apiResponse.internalError(res, error, 'Photo upload failed');
  }
}

export default withAuth(handler);

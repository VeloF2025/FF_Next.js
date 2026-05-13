/**
 * POST /api/works-qa/pole-assign
 *
 * Accepts a multipart upload with:
 *   - pole_id  — UUID of the pole_qa_photos record
 *   - slot     — slot key (civil_01 … joint_16, or 'tray')
 *   - source   — optional, defaults to 'upload'
 *   - photo    — image file
 *
 * Uploads to VF Storage, runs VLM validation, updates pole_qa_photos.
 * Returns { photo_key, vlm }.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';
import { vfStorage } from '@/services/vfStorageAdapter';
import { getSlotMeta } from '@/modules/works-qa/utils/slot-keys';
import { validatePhotoWithVlm } from '@/modules/works-qa/services/worksQaVlmService';
import type { VlmSlotResult } from '@/modules/works-qa/types/works-qa.types';

export const config = {
  api: {
    bodyParser: false,
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

interface ParsedForm {
  fields: formidable.Fields;
  files: formidable.Files;
}

function parseForm(req: NextApiRequest): Promise<ParsedForm> {
  return new Promise((resolve, reject) => {
    const form = formidable({ maxFileSize: 20 * 1024 * 1024, keepExtensions: true });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

function firstString(val: string | string[] | undefined): string | undefined {
  if (Array.isArray(val)) return val[0];
  return val;
}

function firstFile(val: formidable.File | formidable.File[] | undefined): formidable.File | undefined {
  if (Array.isArray(val)) return val[0];
  return val;
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  let tempPath: string | null = null;

  try {
    // 1. Parse multipart form
    const { fields, files } = await parseForm(req);

    const poleId = firstString(fields.pole_id);
    const slot = firstString(fields.slot);
    // source is optional metadata — accepted but not persisted to a column
    const photoFile = firstFile(files.photo);

    // 2. Validate required fields
    if (!poleId) return apiResponse.badRequest(res, 'pole_id is required');
    if (!slot) return apiResponse.badRequest(res, 'slot is required');
    if (!photoFile) return apiResponse.badRequest(res, 'photo file is required');

    tempPath = photoFile.filepath;

    // 3. Resolve slot metadata (tray is a special case — no fixed column)
    const isTray = slot === 'tray';
    const slotMeta = isTray ? null : getSlotMeta(slot);

    if (!isTray && !slotMeta) {
      return apiResponse.badRequest(res, `Unknown slot: ${slot}`);
    }

    // 4. Fetch pole to get project_id and pole_label for storage path
    const poleResult = await pool.query<{ project_id: string; pole_label: string }>(
      'SELECT project_id, pole_label FROM pole_qa_photos WHERE id = $1::uuid',
      [poleId]
    );
    const poleRow = poleResult.rows[0];
    if (!poleRow) {
      return apiResponse.notFound(res, 'Pole', poleId);
    }
    const { project_id, pole_label } = poleRow;

    // 5. Build storage path components
    const discipline =
      isTray
        ? 'optical'
        : slotMeta!.discipline === 'civil'
          ? 'civil'
          : 'optical';
    const filename = `${slot}_${Date.now()}.jpg`;
    // VF Storage type = 'works-qa', category = '{project_id}/{pole_label}/{discipline}'
    const storageType = 'works-qa';
    const storageCategory = `${project_id}/${pole_label}/${discipline}`;

    // 6. Read file buffer and upload to VF Storage
    const fileBuffer = fs.readFileSync(photoFile.filepath);
    const uploadResult = await vfStorage.uploadFile(fileBuffer, storageType, storageCategory, filename);

    // uploadResult.path is a bare storage path (no /storage/ prefix).
    // Components render it as /storage/${photoKey}; pon-zip fetches as APP_BASE/storage/${photoKey}.
    const APP_BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.fibreflow.app';
    const photoKey = uploadResult.path; // bare path stored in DB, no /storage/ prefix
    const photoUrl = `${APP_BASE}/storage/${uploadResult.path}`; // absolute URL for VLM

    // 7. Run VLM validation
    const vlmLabel = isTray ? 'Optical Joint Tray' : slotMeta!.label;
    const vlmCheck = isTray
      ? 'Splice tray with fibre routing and splice protectors visible.'
      : slotMeta!.vlmCheck;

    let vlmResult: VlmSlotResult;
    try {
      vlmResult = await validatePhotoWithVlm({
        photoUrl,
        slotKey: slot,
        stepLabel: vlmLabel,
        vlmCheck,
      });
    } catch (vlmErr) {
      log.error('works-qa/pole-assign VLM failed — using fallback', {
        error: vlmErr instanceof Error ? vlmErr.message : String(vlmErr),
        poleId,
        slot,
      });
      vlmResult = { valid: false, confidence: 0, feedback: 'VLM validation unavailable — manual review required' };
    }

    // 8. Persist to DB
    if (isTray) {
      // Tray: append photo key to array, store VLM under timestamped key
      const vlmKey = `tray_${crypto.randomUUID()}`;
      await pool.query(
        `UPDATE pole_qa_photos
         SET main_joint_tray_keys = array_append(main_joint_tray_keys, $1),
             vlm_results = vlm_results || jsonb_build_object($2, $3::jsonb),
             updated_at = NOW()
         WHERE id = $4::uuid`,
        [photoKey, vlmKey, JSON.stringify(vlmResult), poleId]
      );
    } else {
      // Standard slot: update the fixed column + append VLM result
      const dbColumn = slotMeta!.dbColumn;
      await pool.query(
        `UPDATE pole_qa_photos
         SET ${dbColumn} = $1,
             vlm_results = vlm_results || jsonb_build_object($2, $3::jsonb),
             updated_at = NOW()
         WHERE id = $4::uuid`,
        [photoKey, slot, JSON.stringify(vlmResult), poleId]
      );
    }

    // 9. Cleanup temp file (done in finally below)
    return apiResponse.success(res, { photo_key: photoKey, vlm: vlmResult });
  } catch (err) {
    log.error('works-qa/pole-assign error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  } finally {
    if (tempPath) {
      try {
        fs.unlinkSync(tempPath);
      } catch (cleanupErr) {
        log.error('works-qa/pole-assign temp file cleanup failed', {
          error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
          tempPath,
        });
      }
    }
  }
}

export default withAuth(withPermission('construction-qa.works-qa', 'create')(handler));

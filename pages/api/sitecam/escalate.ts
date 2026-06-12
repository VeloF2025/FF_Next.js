/**
 * POST /api/sitecam/escalate
 *
 * Called by the PWA when a technician exhausts all retries for a step.
 * Creates a pwa_escalations row for supervisor review. The final attempt's
 * photo arrives as base64 and is uploaded to VF Storage server-side so the
 * supervisor Failed tab can show exactly which photo failed.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import type { AttendanceSession } from '@/modules/attendance/portal/types';
import type { SiteCamJobType } from '@/modules/sitecam/lib/sitecamSteps';
// attempt_photos[].url is later rendered as <img src> in the supervisor UI, so
// restrict it to VF Storage origins (shared with the gallery seed write path).
import { isAllowedPhotoUrl } from '@/lib/vfStoragePhotoUrl';
import { uploadToVfStorage } from '@/lib/vfStorageUpload';

const MODULE = 'PwaEscalate';

// ~10MB of raw image as base64. A phone photo is well under this; anything
// larger is rejected before we try to buffer it.
const MAX_PHOTO_BASE64_LENGTH = 14_000_000;

interface EscalateBody {
  jobType: SiteCamJobType;
  siteId: string;
  stepNumber: number;
  failReasons: string[];
  attemptPhotos: Array<{ attempt: number; url: string; reasons: string[] }>;
  /** Final failed attempt's photo (base64, no data: prefix) — uploaded server-side. */
  finalPhotoBase64?: string;
  /** 1-based attempt number of the final failed attempt. */
  finalAttemptNumber?: number;
}

async function handler(req: NextApiRequest, res: NextApiResponse, session: AttendanceSession): Promise<void> {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);

  const { jobType, siteId, stepNumber, failReasons, attemptPhotos, finalPhotoBase64, finalAttemptNumber } =
    (req.body ?? {}) as Partial<EscalateBody>;

  if (!jobType || !siteId || stepNumber == null) {
    return apiResponse.badRequest(res, 'jobType, siteId, stepNumber required');
  }

  // Reject the escalation if any attempt photo URL is not a VF Storage URL.
  const photos = (attemptPhotos ?? []).slice();
  if (photos.some((p) => !isAllowedPhotoUrl(p?.url))) {
    return apiResponse.badRequest(res, 'attemptPhotos must reference VF Storage URLs');
  }

  if (typeof finalPhotoBase64 === 'string' && finalPhotoBase64.length > MAX_PHOTO_BASE64_LENGTH) {
    return apiResponse.badRequest(res, 'finalPhotoBase64 too large');
  }

  // Upload the final failed photo to VF Storage so the supervisor can see it.
  // Best-effort: an upload failure must never lose the escalation itself.
  if (typeof finalPhotoBase64 === 'string' && finalPhotoBase64.length > 0) {
    try {
      const attempt = typeof finalAttemptNumber === 'number' && finalAttemptNumber > 0 ? finalAttemptNumber : 3;
      const filename = `escalation_${siteId}_step${stepNumber}_attempt${attempt}.jpg`.replace(/[^a-zA-Z0-9._-]/g, '_');
      const url = await uploadToVfStorage(filename, finalPhotoBase64);
      photos.push({ attempt, url, reasons: failReasons ?? [] });
    } catch (err) {
      log.error('Escalation photo upload failed — recording escalation without photo', { siteId, stepNumber, err: String(err) }, MODULE);
    }
  }

  const techId = session.staffId ?? null;

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO pwa_escalations (job_type, site_id, step_number, tech_id, fail_reasons, attempt_photos)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [jobType, siteId, stepNumber, techId, failReasons ?? [], JSON.stringify(photos)]
  );

  return apiResponse.success(res, { escalationId: rows[0]!.id });
}

export const config = {
  api: { bodyParser: { sizeLimit: '15mb' } },
};

export default withMySession(handler);

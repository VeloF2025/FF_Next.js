/**
 * POST /api/sitecam/escalate
 *
 * Called by the PWA when a technician exhausts all retries for a step.
 * Creates a pwa_escalations row for supervisor review.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import type { AttendanceSession } from '@/modules/attendance/portal/types';
import type { SiteCamJobType } from '@/modules/sitecam/lib/sitecamSteps';
// attempt_photos[].url is later rendered as <img src> in the supervisor UI, so
// restrict it to VF Storage origins (shared with the gallery seed write path).
import { isAllowedPhotoUrl } from '@/lib/vfStoragePhotoUrl';

interface EscalateBody {
  jobType: SiteCamJobType;
  siteId: string;
  stepNumber: number;
  failReasons: string[];
  attemptPhotos: Array<{ attempt: number; url: string; reasons: string[] }>;
}

async function handler(req: NextApiRequest, res: NextApiResponse, session: AttendanceSession): Promise<void> {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);

  const { jobType, siteId, stepNumber, failReasons, attemptPhotos } =
    (req.body ?? {}) as Partial<EscalateBody>;

  if (!jobType || !siteId || stepNumber == null) {
    return apiResponse.badRequest(res, 'jobType, siteId, stepNumber required');
  }

  // Reject the escalation if any attempt photo URL is not a VF Storage URL.
  const photos = attemptPhotos ?? [];
  if (photos.some((p) => !isAllowedPhotoUrl(p?.url))) {
    return apiResponse.badRequest(res, 'attemptPhotos must reference VF Storage URLs');
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

export default withMySession(handler);

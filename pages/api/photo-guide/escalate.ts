/**
 * POST /api/photo-guide/escalate
 *
 * Called by the PWA when a technician exhausts all retries for a step.
 * Creates a pwa_escalations row for supervisor review.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const VF_STORAGE_URL = process.env.VF_STORAGE_URL ?? 'http://100.96.203.105:8091';

// Hosts that legitimately serve VF Storage photos. Public photo URLs use the
// fibreflow.app domains (nginx /storage proxy); the configured storage host is
// added so direct-origin URLs are also accepted.
const ALLOWED_PHOTO_HOSTS = new Set<string>(['vf.fibreflow.app', 'app.fibreflow.app', 'dev.fibreflow.app']);
if (URL.canParse(VF_STORAGE_URL)) ALLOWED_PHOTO_HOSTS.add(new URL(VF_STORAGE_URL).host);

interface EscalateBody {
  jobType: 'activations' | 'civils';
  siteId: string;
  stepNumber: number;
  failReasons: string[];
  attemptPhotos: Array<{ attempt: number; url: string; reasons: string[] }>;
}

/**
 * attempt_photos[].url is later rendered as <img src> in the supervisor UI.
 * Restrict to VF Storage URLs so a client cannot plant an arbitrary
 * (javascript:/data: XSS, SSRF, phishing) URL that executes in a supervisor's
 * session. Accepts same-origin "/storage/..." proxy paths and the known
 * public/storage hosts; rejects any other scheme or host.
 */
function isAllowedPhotoUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  if (url.startsWith('/storage/')) return true; // same-origin nginx proxy path
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return ALLOWED_PHOTO_HOSTS.has(parsed.host);
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
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

  const techId = (req as AuthenticatedNextApiRequest).user?.id ?? null;

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO pwa_escalations (job_type, site_id, step_number, tech_id, fail_reasons, attempt_photos)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [jobType, siteId, stepNumber, techId, failReasons ?? [], JSON.stringify(photos)]
  );

  return apiResponse.success(res, { escalationId: rows[0]!.id });
}

export default withAuth(handler);

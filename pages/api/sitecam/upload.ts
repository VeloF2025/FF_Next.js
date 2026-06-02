/**
 * POST /api/sitecam/upload
 *
 * Called when a technician completes all steps (all passed or escalated).
 * Receives base64 photos, uploads each to VF Storage, then updates the
 * DR or pole record with submission metadata.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import type { SiteCamJobType } from '@/modules/sitecam/lib/sitecamSteps';
import type { GeofencePayload } from '@/modules/sitecam/lib/geofence';

const MODULE = 'PwaUpload';
const VF_STORAGE_URL = process.env.VF_STORAGE_URL ?? 'http://100.96.203.105:8091';
// 12 activation steps + tolerance — guards against an oversized upload payload.
const MAX_PHOTOS = 20;

/**
 * Flatten a geofence payload into the ordered column values for the UPDATE.
 * Order: status, distance_m, device_lat, device_lon, planned_lat, planned_lon,
 *        accuracy_m, submit_lat, submit_lon. All-null when no payload.
 */
export function geofenceColumns(
  g: GeofencePayload | null | undefined,
): Array<string | number | null> {
  if (!g) return [null, null, null, null, null, null, null, null, null];
  return [
    g.status, g.distanceM, g.deviceLat, g.deviceLon,
    g.plannedLat, g.plannedLon, g.accuracyM, g.submitLat, g.submitLon,
  ];
}

/** Strip any path components / unsafe chars from a client-supplied filename. */
function safeFilename(name: unknown): string {
  const base = typeof name === 'string' ? name.split(/[/\\]/).pop() ?? '' : '';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
  return cleaned || `photo_${Date.now()}.jpg`;
}

interface PhotoRecord {
  stepNumber: number;
  stepLabel: string;
  filename: string;
  base64: string;
  /** Photo auto-passed because the VLM was unavailable — flag for manual QA. */
  needsManualReview?: boolean;
}

interface UploadBody {
  jobType: SiteCamJobType;
  siteId: string;
  photos: PhotoRecord[];
  geofence?: GeofencePayload | null;
}

async function uploadToVfStorage(filename: string, base64: string): Promise<string> {
  const buffer = Buffer.from(base64, 'base64');
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: 'image/jpeg' }), filename);
  const resp = await fetch(`${VF_STORAGE_URL}/upload`, { method: 'POST', body: formData });
  if (!resp.ok) throw new Error(`VF Storage upload failed: HTTP ${resp.status}`);
  const json = await resp.json() as { url?: string };
  if (!json.url) throw new Error('VF Storage returned no url');
  return json.url;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);

  const { jobType, siteId, photos, geofence } = (req.body ?? {}) as Partial<UploadBody>;
  if (!jobType || !siteId || !Array.isArray(photos) || photos.length === 0) {
    return apiResponse.badRequest(res, 'jobType, siteId, and photos (non-empty array) required');
  }
  if (photos.length > MAX_PHOTOS) {
    return apiResponse.badRequest(res, `Too many photos (max ${MAX_PHOTOS})`);
  }

  const techId = (req as AuthenticatedNextApiRequest).user?.id ?? null;
  const uploadedUrls: Record<number, string> = {};

  for (const photo of photos) {
    try {
      const url = await uploadToVfStorage(safeFilename(photo.filename), photo.base64);
      uploadedUrls[photo.stepNumber] = url;
    } catch (err) {
      log.error(`Failed to upload step ${photo.stepNumber}`, { error: String(err) }, MODULE);
    }
  }

  // If EVERY upload failed, do not record a zero-photo submission and report
  // success — that would silently lose the technician's work. Fail loudly so
  // the wizard surfaces the error and the photos can be retried.
  if (Object.keys(uploadedUrls).length === 0) {
    log.error('All photo uploads failed — aborting submission', { siteId, photoCount: photos.length }, MODULE);
    return apiResponse.internalError(res, new Error('All photo uploads failed — nothing was saved'));
  }

  // Steps that auto-passed only because the VLM was unavailable — recorded so
  // QA can manually review them. null (not []) when nothing needs review.
  const flaggedSteps = photos
    .filter((p) => p.needsManualReview && uploadedUrls[p.stepNumber] !== undefined)
    .map((p) => p.stepNumber);
  const vlmUnavailableSteps = flaggedSteps.length > 0 ? JSON.stringify(flaggedSteps) : null;

  const gf = geofenceColumns(geofence);

  if (jobType === 'activations') {
    const drNum = siteId.replace(/^DR-/i, '');
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET pwa_submission_at        = NOW(),
           pwa_tech_id              = $1,
           pwa_photo_count          = $2,
           pwa_completed_at         = NOW(),
           pwa_photo_urls           = $3,
           pwa_vlm_unavailable_steps = $4,
           geofence_status          = $6,
           geofence_distance_m      = $7,
           device_lat               = $8,
           device_lon               = $9,
           planned_lat              = $10,
           planned_lon              = $11,
           gps_accuracy_m           = $12,
           submit_lat               = $13,
           submit_lon               = $14
       WHERE drop_number = $5`,
      [techId, Object.keys(uploadedUrls).length, JSON.stringify(uploadedUrls), vlmUnavailableSteps, drNum, ...gf]
    );
  } else {
    await pool.query(
      `UPDATE pole_install_sessions
       SET pwa_submission_at        = NOW(),
           pwa_tech_id              = $1,
           pwa_completed_at         = NOW(),
           pwa_vlm_unavailable_steps = $2,
           geofence_status          = $4,
           geofence_distance_m      = $5,
           device_lat               = $6,
           device_lon               = $7,
           planned_lat              = $8,
           planned_lon              = $9,
           gps_accuracy_m           = $10,
           submit_lat               = $11,
           submit_lon               = $12
       WHERE pole_number = $3`,
      [techId, vlmUnavailableSteps, siteId, ...gf]
    );
  }

  return apiResponse.success(res, {
    uploadedCount: Object.keys(uploadedUrls).length,
    urls: uploadedUrls,
  });
}

export default withAuth(handler);

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
};

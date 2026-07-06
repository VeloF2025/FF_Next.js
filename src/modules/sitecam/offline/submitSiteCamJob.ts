/**
 * Pure offline-submit state machine + flush-payload builder for a SiteCam
 * job. No React, no direct `fetch` — the hook (Task 5/6) owns the network
 * call and IDB wiring; this module only classifies outcomes and shapes the
 * request body so the logic is unit-testable without a browser.
 */

import { QueueFullError, QuotaExceededError } from '@/lib/offline-queue';
import { readFileAsBase64 } from '../lib/fileToBase64';
import { getStepsForJobType, type SiteCamJobType } from '../lib/sitecamSteps';
import type { GeofencePayload } from '../lib/geofence';
import type { SiteCamJobMeta, StoredStepPhoto } from './photoStore';

/** One photo shaped exactly as `/api/sitecam/upload`'s `PhotoRecord` expects. */
export interface SiteCamUploadPhoto {
  stepNumber: number;
  stepLabel: string;
  filename: string;
  base64: string;
  needsManualReview: boolean;
}

/** The exact existing `/api/sitecam/upload` request body, plus the
 *  idempotency key the handler-side guard (Task 4) dedupes retries on. */
export interface SiteCamUploadPayload {
  jobType: SiteCamJobType;
  siteId: string;
  photos: SiteCamUploadPhoto[];
  geofence: GeofencePayload | null;
  clientSubmissionId: string;
}

export type SubmitOutcome = 'submitted' | 'queued' | 'not_saved' | 'error';

/** Read a Blob as raw base64 (no `data:` prefix) — the Blob-at-rest →
 *  base64-on-the-wire conversion at flush time. Delegates to the shared
 *  `readFileAsBase64` (DRY — same FileReader/data-URL-stripping logic). */
export const blobToBase64 = readFileAsBase64;

function stepLabelFor(jobType: SiteCamJobType, stepNumber: number): string {
  const step = getStepsForJobType(jobType).find((s) => s.number === stepNumber);
  return step?.label ?? `Step ${stepNumber}`;
}

/**
 * Convert stored step photos into the exact `/api/sitecam/upload` body,
 * plus `clientSubmissionId`. `stepLabel` is looked up from the job type's
 * step list — the same list the wizard itself renders from.
 */
export async function buildUploadPayload(
  meta: SiteCamJobMeta,
  photos: StoredStepPhoto[],
  geofence: GeofencePayload | null = null,
): Promise<SiteCamUploadPayload> {
  const uploadPhotos = await Promise.all(
    photos.map(async (p) => ({
      stepNumber: p.stepNumber,
      stepLabel: stepLabelFor(meta.siteInfo.jobType, p.stepNumber),
      filename: `step-${p.stepNumber}.jpg`,
      base64: await blobToBase64(p.photoBlob),
      needsManualReview: p.needsManualReview,
    })),
  );

  return {
    jobType: meta.siteInfo.jobType,
    siteId: meta.siteInfo.siteId,
    photos: uploadPhotos,
    geofence,
    clientSubmissionId: meta.clientSubmissionId,
  };
}

/**
 * Classify a submit attempt into an offline-aware outcome. Pure: takes the
 * online flag + whatever was thrown (or undefined, on success) and returns
 * where the job now stands. The caller handles the 2xx ('submitted') case
 * directly — this only classifies a throw or an offline short-circuit.
 *
 * Precedence: a byte/count quota error → `not_saved` FIRST, regardless of
 * connectivity — a hard storage failure is not a connectivity problem and
 * must win even if the device also happens to be offline; offline (with no
 * quota error) → `queued` (never attempted the network); a definitive 4xx
 * (`.status` 400–499) → `error` (won't resolve on retry, surface it);
 * anything else while online (5xx, network throw, unknown) → `queued` for
 * the flush loop to retry.
 */
export function classifySubmit(online: boolean, err: unknown): SubmitOutcome {
  if (err instanceof QuotaExceededError || err instanceof QueueFullError) return 'not_saved';

  if (!online) return 'queued';

  const status = (err as { status?: number } | null | undefined)?.status;
  if (typeof status === 'number' && status >= 400 && status <= 499) return 'error';

  return 'queued';
}

/**
 * Durability helpers wired into `useSiteCamCapture` (Task 5): minting/reusing
 * the per-job `SiteCamJobMeta`, persisting a captured photo's Blob into the
 * keyed store (byte-quota guarded), and hydrating React state from durable
 * storage after a reload. Kept out of the hook file itself (already at the
 * 300-line guideline) and independently testable without `renderHook`.
 */

import { log } from '@/lib/logger';
import { QuotaExceededError } from '@/lib/offline-queue';
import type { SiteCamJobMeta, SiteCamPhotoStore, StoredStepPhoto } from './photoStore';
import { blobToBase64 } from './submitSiteCamJob';
import type { SiteInfo, StepState } from '../hooks/useSiteCamCapture';

const MODULE = 'siteCamJobDurability';

/** RFC4122-shaped v4 id, using the platform UUID generator when available.
 *  Mirrors the fallback already used by the Phase-1 snag-resolve offline
 *  submit path (`submitPhotoWithOfflineFallback.ts`) for older WebViews. */
export function newClientSubmissionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Reuse the job's existing meta record if one exists (stable `clientSubmissionId`
 * across every capture and resubmit); otherwise mint a fresh one. Called on
 * every mount — idempotent, since it only writes when nothing was there yet.
 */
export async function ensureSiteCamJobMeta(
  store: SiteCamPhotoStore,
  siteInfo: SiteInfo,
): Promise<SiteCamJobMeta> {
  const existing = await store.getMeta();
  if (existing) return existing;

  const fresh: SiteCamJobMeta = {
    siteInfo,
    clientSubmissionId: newClientSubmissionId(),
    submitState: 'capturing',
  };
  await store.putMeta(fresh);
  return fresh;
}

export type PersistPhotoResult = 'ok' | 'quota_exceeded';

/**
 * Upsert a captured photo into the durable store. A `QuotaExceededError` is
 * surfaced to the caller (`'quota_exceeded'`) so the step can be kept
 * un-captured — never a silent drop. Any OTHER store failure (e.g. IndexedDB
 * genuinely unavailable in this browser) fails OPEN: durability is
 * best-effort and must never block a technician mid-install.
 */
export async function persistCapturedPhoto(
  store: SiteCamPhotoStore,
  stepNumber: number,
  photoBlob: Blob,
  needsManualReview: boolean,
): Promise<PersistPhotoResult> {
  try {
    await store.putStepPhoto({
      stepNumber,
      photoBlob,
      byteSize: photoBlob.size,
      needsManualReview,
      capturedAt: new Date().toISOString(),
    });
    return 'ok';
  } catch (err) {
    if (err instanceof QuotaExceededError) return 'quota_exceeded';
    log.warn(
      'SiteCam photo store write failed — continuing without durability',
      { stepNumber, err: String(err) },
      MODULE,
    );
    return 'ok';
  }
}

/**
 * Decode every stored photo to base64 up front (cheap — a job has at most 12
 * steps) so the later state merge is synchronous and race-free. A single
 * undecodable Blob is skipped (logged), not fatal to the rest of the restore.
 */
export async function decodeStoredPhotos(photos: StoredStepPhoto[]): Promise<Map<number, string>> {
  const entries = await Promise.all(
    photos.map(async (p): Promise<[number, string] | null> => {
      try {
        return [p.stepNumber, await blobToBase64(p.photoBlob)];
      } catch (err) {
        log.warn('Failed to decode stored SiteCam photo', { stepNumber: p.stepNumber, err: String(err) }, MODULE);
        return null;
      }
    }),
  );
  return new Map(entries.filter((e): e is [number, string] => e !== null));
}

/**
 * Pure merge: fills `photoBase64` for a step whose status shows it was
 * captured but whose photo was stripped (the localStorage draft's
 * "lite/photos-stripped" fallback — now the intended path, since the durable
 * copy lives in IDB). Never overwrites a step that already carries a live
 * `photoBase64` — safe to apply inside a `setStepStates` functional updater
 * even if a real capture completes while the async decode is in flight.
 */
export function mergeHydratedPhotos(
  stepStates: StepState[],
  decoded: Map<number, string>,
): StepState[] {
  return stepStates.map((s) => {
    if (s.status === 'pending' || s.photoBase64 !== null) return s;
    const b64 = decoded.get(s.stepNumber);
    return b64 !== undefined ? { ...s, photoBase64: b64 } : s;
  });
}

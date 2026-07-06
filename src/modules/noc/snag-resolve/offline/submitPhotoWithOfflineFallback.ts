/**
 * Submit a snag verification-step photo with offline fallback.
 *
 * Mirrors attendance's `submitClockEventWithOfflineFallback`:
 *   - offline (or an online attempt that fails with NO HTTP status, i.e. a
 *     network error) → downscale the photo and enqueue it → `queued`.
 *   - online 2xx → `submitted` (uploads the ORIGINAL file — the online path is
 *     unchanged from before this feature, just now carrying a clientUploadId).
 *   - online HTTP error (has a `.status`) → `error`.
 *   - queue full / byte-budget exceeded, or an undecodable image → `not_saved`
 *     with emphatic copy the UI must render as a hard failure (never a check).
 *
 * Pure — no hooks. The caller (useSnagResolve) passes `online` + the queue's
 * `enqueue` in, so the hook that owns the queue lifecycle stays single-purpose.
 * The `clientUploadId` is minted once here and reused for the online POST and
 * the queued payload, so an online-fails-then-queued transition (and every
 * later retry) carries the same idempotency key.
 */

import { QuotaExceededError, QueueFullError } from '@/lib/offline-queue';
import { downscaleImage } from '@/lib/images/downscaleImage';
import { log } from '@/lib/logger';
import { submitSnagPhoto } from './submitSnagPhoto';
import type { PendingSnagPhoto } from './photoQueue';

export interface SnagPhotoCapture {
  token: string;
  stepId: string;
  slotKey?: string;
  actorId?: string;
  file: File;
}

export type SnagPhotoResult =
  | { kind: 'submitted' }
  | { kind: 'queued' }
  /** NOT saved — neither uploaded nor queued. UI MUST render as a failure. */
  | { kind: 'not_saved'; message: string }
  | { kind: 'error'; message: string };

export interface SnagPhotoFallbackDeps {
  online: boolean;
  enqueue: (payload: PendingSnagPhoto) => Promise<void>;
  /** Test seams (default to the real network / downscale / UUID mint). */
  submitOnline?: (payload: PendingSnagPhoto) => Promise<void>;
  downscale?: (file: File) => Promise<Blob>;
  newId?: () => string;
}

function defaultNewId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older WebViews: RFC4122-shaped v4 id so the server's UUID
  // guard (normalizeClientUploadId) accepts it.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function buildPayload(capture: SnagPhotoCapture, blob: Blob, clientUploadId: string): PendingSnagPhoto {
  return {
    token: capture.token,
    stepId: capture.stepId,
    slotKey: capture.slotKey,
    actorId: capture.actorId,
    clientUploadId,
    photoBlob: blob,
    filename: capture.file.name || `photo-${clientUploadId}.jpg`,
    mimeType: blob.type || 'image/jpeg',
    byteSize: blob.size,
    capturedAt: new Date().toISOString(),
  };
}

async function downscaleAndEnqueue(
  capture: SnagPhotoCapture,
  clientUploadId: string,
  downscale: (file: File) => Promise<Blob>,
  enqueue: (payload: PendingSnagPhoto) => Promise<void>
): Promise<SnagPhotoResult> {
  let blob: Blob;
  try {
    blob = await downscale(capture.file);
  } catch (err) {
    // The image couldn't be decoded/processed on this device — not a queue
    // problem. Tell the tech to retake rather than silently dropping it.
    log.error('[snag-resolve] photo downscale failed', { err, stepId: capture.stepId, slotKey: capture.slotKey });
    return {
      kind: 'not_saved',
      message: 'This photo could not be processed on your device — please retake it.',
    };
  }
  try {
    await enqueue(buildPayload(capture, blob, clientUploadId));
    return { kind: 'queued' };
  } catch (err) {
    log.error('[snag-resolve] photo enqueue failed', { err, stepId: capture.stepId, slotKey: capture.slotKey });
    if (err instanceof QuotaExceededError || err instanceof QueueFullError) {
      return {
        kind: 'not_saved',
        message:
          'This photo was NOT saved — your device\'s offline storage for this link is full. ' +
          'Reconnect to sync the queued photos, then try again.',
      };
    }
    return {
      kind: 'not_saved',
      message:
        'This photo was NOT saved on your device. Screenshot this screen and contact your supervisor.',
    };
  }
}

export async function submitPhotoWithOfflineFallback(
  capture: SnagPhotoCapture,
  deps: SnagPhotoFallbackDeps
): Promise<SnagPhotoResult> {
  const submitOnline = deps.submitOnline ?? submitSnagPhoto;
  const downscale = deps.downscale ?? ((file: File) => downscaleImage(file));
  const clientUploadId = (deps.newId ?? defaultNewId)();

  if (!deps.online) {
    return downscaleAndEnqueue(capture, clientUploadId, downscale, deps.enqueue);
  }

  try {
    // Online: upload the original file immediately (unchanged behaviour).
    await submitOnline(buildPayload(capture, capture.file, clientUploadId));
    return { kind: 'submitted' };
  } catch (err) {
    const status = (err as { status?: number } | undefined)?.status;
    if (status === undefined) {
      // No HTTP status → the connection dropped mid-request → fall back to the
      // offline queue (same clientUploadId, so no duplicate if the server
      // actually committed before the socket died).
      return downscaleAndEnqueue(capture, clientUploadId, downscale, deps.enqueue);
    }
    return { kind: 'error', message: `Upload failed (${status}). Please try again.` };
  }
}

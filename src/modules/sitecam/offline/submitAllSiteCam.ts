/**
 * IO orchestration for one SiteCam submit attempt (Task 6). Reads the durable
 * job store, builds the exact `/api/sitecam/upload` payload (Blob→base64 via
 * `buildUploadPayload`), POSTs it, and classifies the result via
 * `classifySubmit`. Used by BOTH the initial Submit tap and the page-context
 * flush retry (`useSiteCamFlush`) so there is exactly one code path for "what
 * does submitting this job actually do" — no risk of the two diverging.
 *
 * The geofence is computed FRESH on every attempt (entry reading + a live
 * `readDeviceLocation` sample) rather than persisted on the job meta:
 * `SiteCamJobMeta` (Task 2, frozen) has no geofence field, and `entryGeofence`
 * is trivially reconstructible on a warm-start reload from the wizard's `gf`
 * URL query param — no IDB round-trip needed for it.
 */

import { log } from '@/lib/logger';
import { readDeviceLocation, type GeofenceReading, type GeofencePayload } from '../lib/geofence';
import { buildUploadPayload, classifySubmit } from './submitSiteCamJob';
import type { SiteCamPhotoStore } from './photoStore';

const MODULE = 'submitAllSiteCam';
const GEOFENCE_TIMEOUT_MS = 10_000;

export type SiteCamSubmitOutcome =
  | { outcome: 'submitted'; uploadedCount: number }
  | { outcome: 'queued' }
  | { outcome: 'not_saved'; message: string }
  | { outcome: 'error'; message: string }
  /** Nothing durable to submit yet (no meta/photos) — a defensive no-op. */
  | { outcome: 'idle' };

export interface AttemptSiteCamSubmitDeps {
  /** Defaults to `navigator.onLine`. Injectable for deterministic tests. */
  online?: boolean;
  fetchImpl?: typeof fetch;
  readLocation?: typeof readDeviceLocation;
}

async function resolveGeofence(
  entryGeofence: GeofenceReading | null,
  readLocation: typeof readDeviceLocation,
): Promise<GeofencePayload | null> {
  if (!entryGeofence) return null;
  const submitPos = await readLocation(GEOFENCE_TIMEOUT_MS);
  return { ...entryGeofence, submitLat: submitPos?.lat ?? null, submitLon: submitPos?.lon ?? null };
}

export async function attemptSiteCamSubmit(
  store: SiteCamPhotoStore,
  entryGeofence: GeofenceReading | null,
  deps: AttemptSiteCamSubmitDeps = {},
): Promise<SiteCamSubmitOutcome> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const readLocation = deps.readLocation ?? readDeviceLocation;
  const online = deps.online ?? (typeof navigator === 'undefined' ? true : navigator.onLine);

  const meta = await store.getMeta();
  if (!meta) return { outcome: 'idle' };

  const photos = await store.listStepPhotos();
  if (photos.length === 0) return { outcome: 'idle' };

  const geofence = await resolveGeofence(entryGeofence, readLocation);
  const payload = await buildUploadPayload(meta, photos, geofence);

  if (!online) {
    await store.putMeta({ ...meta, submitState: 'queued', queuedAt: new Date().toISOString() });
    return { outcome: 'queued' };
  }

  try {
    const res = await fetchImpl('/api/sitecam/upload', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const classified = classifySubmit(true, { status: res.status });
      if (classified === 'error') {
        const text = await res.text().catch(() => `HTTP ${res.status}`);
        return { outcome: 'error', message: text || `HTTP ${res.status}` };
      }
      await store.putMeta({ ...meta, submitState: 'queued', queuedAt: new Date().toISOString() });
      return { outcome: 'queued' };
    }

    const json = (await res.json()) as { data: { uploadedCount: number } };
    await store.clear();
    return { outcome: 'submitted', uploadedCount: json.data.uploadedCount };
  } catch (err) {
    const classified = classifySubmit(true, err);
    if (classified === 'error') {
      return { outcome: 'error', message: err instanceof Error ? err.message : String(err) };
    }
    log.warn('SiteCam submit network error — queued for retry', { err: String(err) }, MODULE);
    await store.putMeta({ ...meta, submitState: 'queued', queuedAt: new Date().toISOString() });
    return { outcome: 'queued' };
  }
}

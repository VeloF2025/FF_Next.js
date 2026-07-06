/**
 * IO orchestration for one SiteCam submit attempt (Task 6). Reads the durable
 * job store, builds the exact `/api/sitecam/upload` payload (Blob→base64 via
 * `buildUploadPayload`), POSTs it, and classifies the result via
 * `classifySubmit`. Used by BOTH the initial Submit tap and the page-context
 * flush retry (`useSiteCamFlush`) so there is exactly one code path for "what
 * does submitting this job actually do" — no risk of the two diverging.
 *
 * The geofence is computed on the FIRST attempt (entry reading + a live
 * `readDeviceLocation` sample) and, if that attempt is queued, PERSISTED on
 * the job meta (`submitGeofence`) — every later automatic flush retry reuses
 * that exact at-tap value instead of resampling GPS wherever the device
 * happens to be when the retry fires (blind-review LOW fix, PR-3).
 *
 * The ENTIRE attempt — store reads, payload build, and the network call — is
 * wrapped in one outer try/catch (blind-review MEDIUM fix, PR-3): an
 * unclassified throw (e.g. IDB erroring on `getMeta`/`listStepPhotos`, or an
 * undecodable stored Blob inside `buildUploadPayload`'s `Promise.all`) must
 * never propagate past this function — the caller (`submitAll`'s `onClick`)
 * only does `void submitAll()`, so an uncaught rejection here would silently
 * do nothing visible to the technician.
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

/** Surfaced when the attempt fails before it even reaches the network — a
 *  store read or payload-build error the technician can't do anything about
 *  except retry (never a silent no-op). */
const PREPARE_FAILURE_MESSAGE = "Couldn't prepare your photos to submit — try again.";

export async function attemptSiteCamSubmit(
  store: SiteCamPhotoStore,
  entryGeofence: GeofenceReading | null,
  deps: AttemptSiteCamSubmitDeps = {},
): Promise<SiteCamSubmitOutcome> {
  try {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const readLocation = deps.readLocation ?? readDeviceLocation;
    const online = deps.online ?? (typeof navigator === 'undefined' ? true : navigator.onLine);

    const meta = await store.getMeta();
    if (!meta) return { outcome: 'idle' };

    const photos = await store.listStepPhotos();
    if (photos.length === 0) return { outcome: 'idle' };

    // Reuse the geofence persisted at the FIRST queue-time (the tech's at-tap
    // location) rather than resampling on every automatic retry; only the
    // very first attempt (never yet queued) samples fresh.
    const geofence = meta.submitGeofence !== undefined
      ? meta.submitGeofence
      : await resolveGeofence(entryGeofence, readLocation);
    const payload = await buildUploadPayload(meta, photos, geofence);

    if (!online) {
      await store.putMeta({ ...meta, submitState: 'queued', queuedAt: new Date().toISOString(), submitGeofence: geofence });
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
        await store.putMeta({ ...meta, submitState: 'queued', queuedAt: new Date().toISOString(), submitGeofence: geofence });
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
      await store.putMeta({ ...meta, submitState: 'queued', queuedAt: new Date().toISOString(), submitGeofence: geofence });
      return { outcome: 'queued' };
    }
  } catch (err) {
    // Anything NOT already classified above — a store read (getMeta/
    // listStepPhotos), a payload-build failure (an undecodable stored Blob in
    // buildUploadPayload's Promise.all), or a putMeta/clear failure. Never let
    // this propagate: the caller (`submitAll`'s `onClick={() => void
    // submitAll()}`) has no catch, so an uncaught rejection here would leave
    // the technician tapping Submit with no visible result at all.
    log.error('SiteCam submit attempt failed unexpectedly', { err: String(err) }, MODULE);
    return { outcome: 'error', message: PREPARE_FAILURE_MESSAGE };
  }
}

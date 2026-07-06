/**
 * Network call for a queued snag photo, shaped for useOfflineQueue's `submit`.
 *
 * Rebuilds the exact multipart FormData the online resolve page POSTs
 * (`action=upload_photo`, file, stepId, slotKey?, actorId?) plus the
 * `clientUploadId` the server dedupes on (migration 438). Throws with a
 * `.status` on HTTP failure so the queue's default classifier drains 400/409
 * and keeps 5xx/network; a bare network error (no `.status`) is also kept.
 */

import type { PendingSnagPhoto } from './photoQueue';

export async function submitSnagPhoto(payload: PendingSnagPhoto): Promise<void> {
  const form = new FormData();
  form.append('action', 'upload_photo');
  form.append('file', payload.photoBlob, payload.filename);
  form.append('stepId', payload.stepId);
  if (payload.slotKey) form.append('slotKey', payload.slotKey);
  if (payload.actorId) form.append('actorId', payload.actorId);
  form.append('clientUploadId', payload.clientUploadId);

  const res = await fetch(`/api/snags/shared/${encodeURIComponent(payload.token)}`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const err = new Error(`upload_photo failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
}

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
    // Pull the server's reason out of the JSON body when present so a
    // permanently-dropped photo surfaces WHY (e.g. "step is already complete")
    // in the dropped-photo banner, not just a bare status code.
    const body = typeof res.json === 'function' ? await res.json().catch(() => null) : null;
    const reason = (body as { error?: { message?: string } } | null)?.error?.message;
    const detail = typeof reason === 'string' && reason ? `: ${reason}` : '';
    const err = new Error(`upload_photo failed (${res.status})${detail}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
}

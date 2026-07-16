// Client-side API helpers for PoleDetailPanel. Kept here so the component
// file stays under the 300-line hard rule.

import { log } from '@/lib/logger';
import type { SnagSubmitInput, SnagSubmitResult } from '../components/SnagInlineForm';

// Best-effort parser for an apiResponse envelope when surfacing a non-OK response.
// Returns null when the body isn't valid JSON (e.g. nginx-rendered 502 HTML) so the
// caller can fall back to a generic "<verb> failed (<status>)" message.
async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return await res.json() as T;
  } catch (err) {
    log.debug('works-qa: response body not JSON', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function assignPhoto(poleId: string, slot: string, file: File): Promise<void> {
  const form = new FormData();
  form.append('pole_id', poleId);
  form.append('slot', slot);
  form.append('photo', file);
  form.append('source', 'upload');
  const res = await fetch('/api/works-qa/pole-assign', { method: 'POST', body: form });
  if (!res.ok) {
    // Surface the actual API error so PhotoSlotCard can show it inline to the user.
    const body = await safeJson<{ error?: { message?: string } }>(res);
    throw new Error(body?.error?.message ?? `Upload failed (${res.status})`);
  }
}

export async function overrideSlot(poleId: string, slot: string, decision: 'pass' | 'fail', reason: string): Promise<void> {
  const res = await fetch('/api/works-qa/pole-override', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pole_id: poleId, slot, decision, reason }),
  });
  if (!res.ok) throw new Error(`Override failed: ${res.status}`);
}

export async function movePhoto(poleId: string, photoKey: string, from: string, to: string): Promise<void> {
  const res = await fetch('/api/works-qa/move-photo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pole_id: poleId, photo_key: photoKey, from, to }),
  });
  if (!res.ok) {
    const body = await safeJson<{ error?: string }>(res);
    throw new Error(body?.error ?? `Move failed: ${res.status}`);
  }
}

/**
 * Soft-delete bin: move a photo between the unassigned and deleted buckets.
 *   action='delete'  → unassigned → deleted
 *   action='restore' → deleted → unassigned
 */
export async function binPhoto(poleId: string, photoKey: string, action: 'delete' | 'restore'): Promise<void> {
  const res = await fetch('/api/works-qa/photo-bin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pole_id: poleId, photo_key: photoKey, action }),
  });
  if (!res.ok) {
    const body = await safeJson<{ error?: { message?: string } }>(res);
    throw new Error(body?.error?.message ?? `${action === 'delete' ? 'Delete' : 'Restore'} failed (${res.status})`);
  }
}

/** Re-open a previously-approved discipline so its photos can be edited again. */
export async function reopenDiscipline(poleId: string, discipline: 'civil' | 'dome' | 'main_joint'): Promise<void> {
  const res = await fetch('/api/works-qa/pole-reopen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pole_id: poleId, discipline }),
  });
  if (!res.ok) {
    const body = await safeJson<{ error?: { message?: string } }>(res);
    throw new Error(body?.error?.message ?? `Re-open failed (${res.status})`);
  }
}

export async function linkPhoto(poleId: string, sourceSlot: string, targetSlot: string, reason?: string): Promise<void> {
  const res = await fetch('/api/works-qa/link-photo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pole_id: poleId, source_slot: sourceSlot, target_slot: targetSlot, reason }),
  });
  if (!res.ok) {
    const body = await safeJson<{ error?: { message?: string } }>(res);
    throw new Error(body?.error?.message ?? `Link failed (${res.status})`);
  }
}

export async function uploadTrayPhotos(poleId: string, files: File[]): Promise<void> {
  // Surface the first failure so TrayBucket can show it inline. Subsequent files
  // are skipped — the user can retry the batch after fixing the issue.
  for (const file of files) {
    const form = new FormData();
    form.append('pole_id', poleId);
    form.append('slot', 'tray');
    form.append('photo', file);
    form.append('source', 'upload');
    const res = await fetch('/api/works-qa/pole-assign', { method: 'POST', body: form });
    if (!res.ok) {
      const body = await safeJson<{ error?: { message?: string } }>(res);
      throw new Error(body?.error?.message ?? `Tray upload failed (${res.status})`);
    }
  }
}

export async function approvePhotoApi(poleQaPhotoId: string, slotKey: string): Promise<void> {
  const res = await fetch('/api/works-qa/photo-approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pole_qa_photo_id: poleQaPhotoId, slot_key: slotKey }),
  });
  if (!res.ok) {
    const body = await safeJson<{ error?: { message?: string } }>(res);
    throw new Error(body?.error?.message ?? `Approve failed: ${res.status}`);
  }
}

export async function snagPhotoApi(
  poleQaPhotoId: string,
  slotKey: string,
  input: SnagSubmitInput,
): Promise<SnagSubmitResult> {
  const res = await fetch('/api/works-qa/photo-snag', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pole_qa_photo_id: poleQaPhotoId,
      slot_key: slotKey,
      comment: input.comment,
      severity: input.severity,
      assigned_to_user_id: input.assignedToUserId ?? undefined,
      amend: input.amend ?? false,
    }),
  });
  const body = await safeJson<{
    data?: { status?: 'created' | 'amended'; snag?: { id: string } };
    error?: { message?: string; details?: { existing_snag_id?: string } };
  }>(res);
  if (res.status === 409) {
    return { status: 'duplicate', existingSnagId: body?.error?.details?.existing_snag_id };
  }
  if (!res.ok) {
    return { status: 'error', errorMessage: body?.error?.message ?? `Snag failed: ${res.status}` };
  }
  const status = body?.data?.status === 'amended' ? 'amended' : 'created';
  return { status };
}

// Client-side API helpers for PoleDetailPanel. Kept here so the component
// file stays under the 300-line hard rule.

import { log } from '@/lib/logger';
import type { SnagSubmitInput, SnagSubmitResult } from '../components/SnagInlineForm';

export async function assignPhoto(poleId: string, slot: string, file: File): Promise<void> {
  const form = new FormData();
  form.append('pole_id', poleId);
  form.append('slot', slot);
  form.append('photo', file);
  form.append('source', 'upload');
  const res = await fetch('/api/works-qa/pole-assign', { method: 'POST', body: form });
  if (!res.ok) throw new Error('Upload failed');
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
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Move failed: ${res.status}`);
  }
}

export async function uploadTrayPhotos(poleId: string, files: File[]): Promise<void> {
  for (const file of files) {
    const form = new FormData();
    form.append('pole_id', poleId);
    form.append('slot', 'tray');
    form.append('photo', file);
    form.append('source', 'upload');
    const res = await fetch('/api/works-qa/pole-assign', { method: 'POST', body: form });
    if (!res.ok) log.error('works-qa: tray upload failed', { status: res.status });
  }
}

export async function approvePhotoApi(poleQaPhotoId: string, slotKey: string): Promise<void> {
  const res = await fetch('/api/works-qa/photo-approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pole_qa_photo_id: poleQaPhotoId, slot_key: slotKey }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Approve failed: ${res.status}`);
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
  const body = await res.json().catch(() => ({})) as {
    data?: { status?: 'created' | 'amended'; snag?: { id: string } };
    error?: { message?: string; details?: { existing_snag_id?: string } };
  };
  if (res.status === 409) {
    return { status: 'duplicate', existingSnagId: body.error?.details?.existing_snag_id };
  }
  if (!res.ok) {
    return { status: 'error', errorMessage: body.error?.message ?? `Snag failed: ${res.status}` };
  }
  const status = body.data?.status === 'amended' ? 'amended' : 'created';
  return { status };
}

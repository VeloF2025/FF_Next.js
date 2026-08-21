/**
 * Pickings (issue submission) API helper for the field-stock PWA.
 *
 * Maps PwaIssueDraft to the POST /api/my/stores/pickings body.
 * Both sourceLocationId and destinationLocationId are required fields on
 * PwaIssueDraft and must be valid FK references to stock_locations.id:
 *  - sourceLocationId: the warehouse chosen by the stores person (PickWarehouseStep).
 *  - destinationLocationId: the fixed FIELD-DEFAULT UUID seeded by migration 357.
 *
 * Serial issues: serial_ids on each line hold the stock serial number strings (not
 * UUIDs); plannedQuantity = serials.length.
 * Non-serial issues: serialIds is omitted; plannedQuantity comes from draft.quantity;
 * proofPhotoKey + proofPhotoUrl are required and included in the picking body.
 */

import { request, ApiError } from './request';
import type { PwaIssueDraft, PwaPickingResult } from '../types';

// =============================================================================
// Public API
// =============================================================================

/**
 * Submit a completed issue draft to the server.
 *
 * "Sign and submit" must COMPLETE the stock issue, not merely stage a draft.
 * The picking lifecycle is draft → confirmed → (signed) → processed, and only
 * the `process` step actually promotes the serials to `issued` and posts
 * custody. So this drives all of those steps in sequence:
 *
 *   1. create   → POST /pickings                  (draft)
 *   2. confirm  → POST /pickings/:id/confirm       (confirmed)
 *   3. sign     → POST /pickings/:id/sign          (persist signature)
 *   4. process  → POST /pickings/:id/process       (promote serials → issued)
 *
 * Any failed step throws (surfaced as an inline error in the UI) rather than
 * returning a misleading "issued" result for a picking still sitting in draft.
 */
export async function submitIssue(
  draft: PwaIssueDraft,
  idempotencyKey?: string,
): Promise<PwaPickingResult> {
  const isSerialIssue = draft.serials.length > 0;
  const body = {
    pickingType: 'issue',
    sourceLocationId: draft.sourceLocationId,
    destinationLocationId: draft.destinationLocationId,
    projectId: draft.projectId ?? undefined,
    technicianId: draft.technicianId,
    contractorId: draft.contractorId ?? undefined,
    notes: draft.notes || undefined,
    proofPhotoKey: draft.proofPhotoKey,
    proofPhotoUrl: draft.proofPhotoUrl,
    // Stable per draft (the offline-queue item id): a retry after a network blip
    // dedupes server-side to the same picking instead of issuing stock twice.
    idempotencyKey,
    lines: [
      {
        stockItemId: draft.stockItemId,
        plannedQuantity: isSerialIssue ? draft.serials.length : (draft.quantity ?? 0),
        serialIds: isSerialIssue ? draft.serials.map((s) => s.serialNumber) : undefined,
        // EVERY raw carton payload in the draft, so the server can re-derive
        // which serials the scans corroborate. Deliberately not a list of
        // "trust these": a typed serial must not be able to mint a phantom ONT
        // issued to a named technician, and a flag the client sets cannot
        // prevent that.
        //
        // All of them, not the first: a storeman can scan two cartons of the
        // same item into one handout, and corroborating the second against the
        // first carton's payload would refuse genuinely scanned stock — the
        // very failure this feature exists to fix.
        // Label photos for single units the sheet has never listed. Without
        // these the server refuses them — a carton corroborates itself, a lone
        // unit does not, and a Gizzu has no carton.
        intakePhotos: isSerialIssue
          ? draft.serials
              .filter((s) => s.intakePhotoKey)
              .map((s) => ({
                serialNumber: s.serialNumber,
                photoKey: s.intakePhotoKey!,
                photoUrl: s.intakePhotoUrl ?? null,
              }))
          : undefined,
        intakeScanPayloads: isSerialIssue
          ? [...new Set(draft.serials.map((s) => s.scanPayload).filter((p): p is string => !!p))]
          : undefined,
        intakeCartonId: isSerialIssue
          ? (draft.serials.find((s) => s.cartonId)?.cartonId ?? null)
          : undefined,
        notes: draft.notes || undefined,
      },
    ],
  };

  // 1. Create the picking. On an idempotent replay the server returns the
  //    EXISTING picking, whose status tells us which steps already ran — so we
  //    resume the chain rather than re-running (and re-issuing) completed steps.
  const picking = await request<{
    id: string;
    picking_number: string;
    status: string;
  }>('/api/my/stores/pickings', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const base = `/api/my/stores/pickings/${picking.id}`;
  const status = picking.status;

  // Already fully processed on a prior attempt → nothing left to do.
  if (status !== 'draft' && status !== 'confirmed') {
    return { pickingId: picking.id, pickingNumber: picking.picking_number, status: 'processed' };
  }

  // 2. Confirm (draft → confirmed). process() rejects anything not 'confirmed'.
  if (status === 'draft') {
    await request<unknown>(`${base}/confirm`, { method: 'POST', body: '{}' });
  }

  // 3. Persist the technician's signature. signedBy is the technician's staff
  //    UUID (not a name): process() reads stock_pickings.signed_by as the
  //    lifecycle-event actor and casts it to uuid, so a name would break it.
  //    Signing is idempotent (overwrites), so it's safe to repeat on a replay.
  if (draft.signatureDataUrl) {
    await request<unknown>(`${base}/sign`, {
      method: 'POST',
      body: JSON.stringify({
        signatureData: draft.signatureDataUrl,
        signedBy: draft.technicianId,
      }),
    });
  }

  // 4. Process (confirmed → done): promotes serials to 'issued' + posts custody.
  await request<unknown>(`${base}/process`, { method: 'POST', body: '{}' });

  return {
    pickingId: picking.id,
    pickingNumber: picking.picking_number,
    status: 'processed',
  };
}

/**
 * Upload the mandatory proof photo for a non-serial issue. Multipart, so it
 * bypasses the JSON request() helper. Returns the storage key+URL to include
 * in the subsequent picking create.
 */
export async function uploadIssueProof(photo: Blob): Promise<{ photoKey: string; photoUrl: string }> {
  const form = new FormData();
  form.append('photo', photo, 'proof.jpg');
  const res = await fetch('/api/my/stores/pickings/upload-proof', { method: 'POST', body: form });
  const json = (await res.json()) as {
    success: boolean;
    data?: { photoKey: string; photoUrl: string };
    error?: { code?: string; message?: string };
  };
  if (!res.ok || !json.success || !json.data) {
    throw new ApiError(
      res.status,
      json.error?.code ?? 'UPLOAD_ERROR',
      json.error?.message ?? `Proof upload failed (${res.status})`,
    );
  }
  return json.data;
}

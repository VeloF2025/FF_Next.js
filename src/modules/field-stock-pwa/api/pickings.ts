/**
 * Pickings (issue submission) API helper for the field-stock PWA.
 *
 * Maps PwaIssueDraft to the POST /api/procurement/field-stock/pickings body.
 * Both sourceLocationId and destinationLocationId are required fields on
 * PwaIssueDraft and must be valid FK references to stock_locations.id:
 *  - sourceLocationId: the warehouse chosen by the stores person (PickWarehouseStep).
 *  - destinationLocationId: the fixed FIELD-DEFAULT UUID seeded by migration 357.
 *
 * serial_ids on each line are the stock serial number strings (not UUIDs); the
 * pickings endpoint stores them in the serial_ids column on the picking line.
 */

import { request } from './request';
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
export async function submitIssue(draft: PwaIssueDraft): Promise<PwaPickingResult> {
  const body = {
    pickingType: 'issue',
    sourceLocationId: draft.sourceLocationId,
    destinationLocationId: draft.destinationLocationId,
    technicianId: draft.technicianId,
    contractorId: draft.contractorId ?? undefined,
    notes: draft.notes || undefined,
    lines: [
      {
        stockItemId: draft.stockItemId,
        plannedQuantity: draft.serials.length,
        serialIds: draft.serials.map((s) => s.serialNumber),
        notes: draft.notes || undefined,
      },
    ],
  };

  // 1. Create the picking (draft).
  const picking = await request<{
    id: string;
    picking_number: string;
    status: string;
  }>('/api/procurement/field-stock/pickings', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const base = `/api/procurement/field-stock/pickings/${picking.id}`;

  // 2. Confirm (draft → confirmed). process() rejects anything not 'confirmed'.
  await request<unknown>(`${base}/confirm`, { method: 'POST', body: '{}' });

  // 3. Persist the technician's signature. signedBy is the technician's staff
  //    UUID (not a name): process() reads stock_pickings.signed_by as the
  //    lifecycle-event actor and casts it to uuid, so a name would break it.
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

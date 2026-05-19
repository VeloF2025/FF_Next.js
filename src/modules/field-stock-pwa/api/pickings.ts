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
    ...(draft.signatureDataUrl ? { signatureDataUrl: draft.signatureDataUrl } : {}),
  };

  const picking = await request<{
    id: string;
    picking_number: string;
    status: string;
  }>('/api/procurement/field-stock/pickings', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return {
    pickingId: picking.id,
    pickingNumber: picking.picking_number,
    status: picking.status as PwaPickingResult['status'],
  };
}

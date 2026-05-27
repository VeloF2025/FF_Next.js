/**
 * Returns API client for the field-stock PWA.
 *
 * Translates PwaReturnDraft → POST /api/procurement/field-stock/returns body.
 * Two-step inspect+accept exposed as a single call submitInspectAndAccept().
 *
 * Idempotency: callers must pass a UUID; the server dedupes via the
 * stock_returns.idempotency_key column added by migration 359.
 */

import { request } from './request';
import type {
  PwaReturnDraft,
  PwaReturnResult,
  PwaInspectAcceptDraft,
} from '../types';

interface ReturnsApiResponseLine {
  id: string;
  stock_item_id: string;
  serial_id: string | null;
  serial_number: string | null;
  quantity: number;
  condition: string | null;
  return_reason: string | null;
  disposition: string | null;
  notes: string | null;
}

interface ReturnsApiResponse {
  id: string;
  return_number: string;
  status: string;
  lines: ReturnsApiResponseLine[];
}

/**
 * Submit a completed return draft to the server.
 *
 * @param draft           The return draft from the wizard.
 * @param idempotencyKey  Client-generated UUID. The same key on a re-submit
 *                        returns the original return without creating a duplicate.
 */
export async function submitReturn(
  draft: PwaReturnDraft,
  idempotencyKey: string,
): Promise<PwaReturnResult> {
  const body = {
    idempotencyKey,
    returnToLocationId: draft.returnToLocationId,
    originalPickingId: draft.originalPickingId ?? undefined,
    notes: draft.notes || undefined,
    signatureDataUrl: draft.signatureDataUrl || undefined,
    lines: draft.serials.map((s) => ({
      stockItemId: s.stockItemId,
      serialId: s.serialId,
      serialNumber: s.serialNumber,
      quantity: 1,
      returnReason: draft.reason,
    })),
  };

  const r = await request<ReturnsApiResponse>(
    '/api/procurement/field-stock/returns',
    { method: 'POST', body: JSON.stringify(body) },
  );

  return {
    returnId: r.id,
    returnNumber: r.return_number,
    status: r.status as PwaReturnResult['status'],
  };
}

/**
 * Single client action that drives the storeman's disposition flow:
 *  1. POST /returns/:id/inspect — applies per-line condition/disposition
 *  2. POST /returns/:id/accept — restocks (updates serials + quants)
 *
 * If accept fails after inspect succeeded, the return is in 'inspected' status
 * and the caller must call retryAccept (NOT submitInspectAndAccept again).
 */
export async function submitInspectAndAccept(
  draft: PwaInspectAcceptDraft,
): Promise<PwaReturnResult> {
  const inspectBody = {
    inspectionNotes: draft.inspectionNotes || undefined,
    signatureDataUrl: draft.signatureDataUrl || undefined,
    lineDispositions: Object.fromEntries(
      draft.lineDispositions.map((ld) => [
        ld.lineId,
        {
          condition: ld.condition,
          disposition: ld.disposition,
          notes: ld.notes ?? undefined,
        },
      ]),
    ),
  };

  await request<ReturnsApiResponse>(
    `/api/procurement/field-stock/returns/${encodeURIComponent(draft.returnId)}/inspect`,
    { method: 'POST', body: JSON.stringify(inspectBody) },
  );

  const accepted = await request<ReturnsApiResponse>(
    `/api/procurement/field-stock/returns/${encodeURIComponent(draft.returnId)}/accept`,
    { method: 'POST', body: JSON.stringify({}) },
  );

  return {
    returnId: accepted.id,
    returnNumber: accepted.return_number,
    status: accepted.status as PwaReturnResult['status'],
  };
}

/** Retry-accept only — used when previous accept failed but inspect succeeded. */
export async function retryAccept(returnId: string): Promise<PwaReturnResult> {
  const accepted = await request<ReturnsApiResponse>(
    `/api/procurement/field-stock/returns/${encodeURIComponent(returnId)}/accept`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return {
    returnId: accepted.id,
    returnNumber: accepted.return_number,
    status: accepted.status as PwaReturnResult['status'],
  };
}

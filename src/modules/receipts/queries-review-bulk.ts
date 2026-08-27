/**
 * Bulk sibling of transitionReceiptStatus (queries-review.ts). Split
 * into its own file to keep queries-review.ts under the 300-line cap —
 * same reason that file was split out of queries.ts originally.
 *
 * One UPDATE for the whole selection, same adjacency rules as the
 * single-row transition. Ids already updated by someone else (or never
 * eligible for this action) simply don't match the WHERE and come back
 * in skippedIds rather than failing the batch.
 */

import { sql } from '@/lib/db-pool';

import type { ReceiptRow } from './queries';
import {
  ACTION_TO_STATUS,
  UUID_RE,
  allowedFromStatusesFor,
  type ReviewAction,
} from './queries-review';

export interface BulkTransitionResult {
  updated: ReceiptRow[];
  skippedIds: string[];
}

export async function transitionReceiptStatusBulk(args: {
  ids: string[];
  action: ReviewAction;
  reviewerId: string;
  note: string | null;
}): Promise<BulkTransitionResult> {
  const uniqueIds = Array.from(new Set(args.ids));
  if (uniqueIds.length === 0) {
    throw new Error('transitionReceiptStatusBulk: ids must not be empty');
  }
  if (uniqueIds.some((id) => !UUID_RE.test(id))) {
    throw new Error('transitionReceiptStatusBulk: every id must be a UUID');
  }
  if (!UUID_RE.test(args.reviewerId)) {
    throw new Error('transitionReceiptStatusBulk: reviewerId must be a UUID');
  }
  const target = ACTION_TO_STATUS[args.action];
  const allowedFrom = allowedFromStatusesFor(target);

  const rows = await sql<ReceiptRow>`
    UPDATE staff_receipts
    SET
      status       = ${target},
      reviewed_by  = ${args.reviewerId},
      reviewed_at  = NOW(),
      review_note  = ${args.note},
      updated_at   = NOW()
    WHERE id = ANY(${uniqueIds}::uuid[])
      AND status = ANY(${allowedFrom}::text[])
    RETURNING
      id, staff_id,
      to_char(receipt_date, 'YYYY-MM-DD') AS receipt_date,
      vendor, total_cents, vat_cents, currency,
      category, description, payment_method,
      project_id, vehicle_assignment_id,
      image_url, image_mime,
      captured_lat, captured_lon, captured_at,
      ocr_raw, ocr_category_guess, ocr_confidence,
      status, reviewed_by, reviewed_at, review_note,
      created_at, updated_at
  `;
  const updatedIds = new Set(rows.map((r) => r.id));
  const skippedIds = uniqueIds.filter((id) => !updatedIds.has(id));
  return { updated: rows, skippedIds };
}

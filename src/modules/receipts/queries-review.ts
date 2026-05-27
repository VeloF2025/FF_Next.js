/**
 * SQL helpers for the receipts review queue (finance / HR side).
 *
 * Split out of queries.ts to keep both files under the 300-line cap.
 * The staff-self queries (insert / listForStaff / findById /
 * updateOwnSubmittedReceipt) live in ./queries; this file is everything
 * a `receipts.review`-gated caller needs.
 *
 * DATE columns are projected through `to_char()` so they come back as
 * YYYY-MM-DD strings — pg's default Date conversion uses server-local
 * midnight which JSON-serialises to UTC and silently shifts a day in
 * SAST.
 */

import { sql } from '@/lib/db-pool';

import type { ReceiptCategory } from './categories';
import type {
  PaymentMethod,
  ReceiptRow,
  ReceiptStatus,
} from './queries';

// -----------------------------------------------------------------------------
// Filters + types
// -----------------------------------------------------------------------------

export interface ReviewListFilters {
  staffId?: string | null;
  projectId?: string | null;
  category?: ReceiptCategory | null;
  status?: ReceiptStatus | null;
  month?: string | null;            // YYYY-MM, filters receipt_date
  limit?: number;
  offset?: number;
}

export interface ReviewListItem extends Record<string, unknown> {
  id: string;
  staff_id: string;
  staff_name: string | null;
  staff_email: string | null;
  receipt_date: string;
  vendor: string | null;
  total_cents: string;
  vat_cents: string | null;
  currency: string;
  category: ReceiptCategory;
  description: string | null;
  payment_method: PaymentMethod;
  project_id: string | null;
  project_name: string | null;
  vehicle_assignment_id: string | null;
  vehicle_registration: string | null;
  image_url: string;
  image_mime: string;
  status: ReceiptStatus;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  captured_at: string;
  ocr_confidence: string | null;
  ocr_category_guess: string | null;
}

export interface ReviewSummaryRow extends Record<string, unknown> {
  status: ReceiptStatus;
  count: string;
  total_cents: string;
}

// -----------------------------------------------------------------------------
// List + summary
// -----------------------------------------------------------------------------

/**
 * Finance/HR review queue. Joins staff + project + vehicle assignment +
 * reviewer for display. Default ordering puts oldest 'submitted' first
 * (review backlog FIFO); other statuses sort by receipt_date desc.
 *
 * Filters compose with AND. All optional. Caller MUST be gated by
 * receipts.review permission — this query has no scope clause.
 */
export async function listReceiptsForReview(
  filters: ReviewListFilters
): Promise<ReviewListItem[]> {
  const limit = Math.max(1, Math.min(filters.limit ?? 200, 5000));
  const offset = Math.max(0, filters.offset ?? 0);
  const staffId = filters.staffId ?? null;
  const projectId = filters.projectId ?? null;
  const category = filters.category ?? null;
  const status = filters.status ?? null;
  const monthStart = filters.month ? `${filters.month}-01` : null;

  return sql<ReviewListItem>`
    SELECT
      r.id,
      r.staff_id,
      TRIM(CONCAT(s.first_name, ' ', s.last_name)) AS staff_name,
      s.email AS staff_email,
      to_char(r.receipt_date, 'YYYY-MM-DD') AS receipt_date,
      r.vendor, r.total_cents, r.vat_cents, r.currency,
      r.category, r.description, r.payment_method,
      r.project_id, p.project_name AS project_name,
      r.vehicle_assignment_id, va.vehicle_registration,
      r.image_url, r.image_mime,
      r.status, r.reviewed_by,
      TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS reviewed_by_name,
      r.reviewed_at, r.review_note,
      r.captured_at,
      r.ocr_confidence, r.ocr_category_guess
    FROM staff_receipts r
    LEFT JOIN staff s   ON s.id = r.staff_id
    LEFT JOIN projects p ON p.id = r.project_id
    LEFT JOIN vehicle_assignments va ON va.id = r.vehicle_assignment_id
    LEFT JOIN users u   ON u.id = r.reviewed_by
    WHERE
      (${staffId}::uuid IS NULL OR r.staff_id = ${staffId})
      AND (${projectId}::uuid IS NULL OR r.project_id = ${projectId})
      AND (${category}::text IS NULL OR r.category = ${category})
      AND (${status}::text IS NULL OR r.status = ${status})
      AND (
        ${monthStart}::date IS NULL
        OR (
          r.receipt_date >= ${monthStart}::date
          AND r.receipt_date < (${monthStart}::date + INTERVAL '1 month')
        )
      )
    ORDER BY
      CASE WHEN r.status = 'submitted' THEN 0 ELSE 1 END,
      CASE WHEN r.status = 'submitted' THEN r.created_at END ASC,
      r.receipt_date DESC,
      r.created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}

/**
 * Aggregate counts + totals per status, scoped to the same filters as
 * listReceiptsForReview minus pagination. Cheap headline numbers for
 * the queue header.
 */
export async function summariseReceiptsForReview(
  filters: Omit<ReviewListFilters, 'limit' | 'offset'>
): Promise<ReviewSummaryRow[]> {
  const staffId = filters.staffId ?? null;
  const projectId = filters.projectId ?? null;
  const category = filters.category ?? null;
  const status = filters.status ?? null;
  const monthStart = filters.month ? `${filters.month}-01` : null;

  return sql<ReviewSummaryRow>`
    SELECT status, COUNT(*)::text AS count, COALESCE(SUM(total_cents), 0)::text AS total_cents
    FROM staff_receipts r
    WHERE
      (${staffId}::uuid IS NULL OR r.staff_id = ${staffId})
      AND (${projectId}::uuid IS NULL OR r.project_id = ${projectId})
      AND (${category}::text IS NULL OR r.category = ${category})
      AND (${status}::text IS NULL OR r.status = ${status})
      AND (
        ${monthStart}::date IS NULL
        OR (
          r.receipt_date >= ${monthStart}::date
          AND r.receipt_date < (${monthStart}::date + INTERVAL '1 month')
        )
      )
    GROUP BY status
  `;
}

// -----------------------------------------------------------------------------
// Lifecycle / state machine
// -----------------------------------------------------------------------------

export type ReviewAction = 'approve' | 'reject' | 'reconcile';

export const ACTION_TO_STATUS: Record<ReviewAction, ReceiptStatus> = {
  approve: 'approved',
  reject: 'rejected',
  reconcile: 'reconciled',
};

/**
 * Authoritative receipt-lifecycle adjacency map.
 *
 * `ALLOWED_TRANSITIONS[from]` lists every status the row can move INTO
 * while currently in `from`. The SQL `WHERE` clause and any unit tests
 * are both derived from this constant — never duplicate the rules.
 *
 *   submitted  → approved | rejected
 *   approved   → reconciled | rejected   (re-inspection or post-bank-match flip)
 *   rejected   → approved                (HR re-approves after fixing paperwork)
 *   reconciled → approved                (rare undo, e.g. duplicate found later)
 *
 * Caller maps `null` return to 404 (no row) or 409 (illegal transition).
 */
export const ALLOWED_TRANSITIONS: Record<ReceiptStatus, readonly ReceiptStatus[]> = {
  submitted: ['approved', 'rejected'],
  approved: ['reconciled', 'rejected'],
  rejected: ['approved'],
  reconciled: ['approved'],
};

/**
 * Inverse of ALLOWED_TRANSITIONS: which `from` statuses may move into
 * the given `target`. Drives the SQL `status = ANY(...)` predicate.
 */
export function allowedFromStatusesFor(target: ReceiptStatus): ReceiptStatus[] {
  return (Object.keys(ALLOWED_TRANSITIONS) as ReceiptStatus[]).filter((from) =>
    ALLOWED_TRANSITIONS[from].includes(target)
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function transitionReceiptStatus(args: {
  id: string;
  action: ReviewAction;
  reviewerId: string;
  note: string | null;
}): Promise<ReceiptRow | null> {
  if (!UUID_RE.test(args.id)) {
    throw new Error('transitionReceiptStatus: id must be a UUID');
  }
  if (!UUID_RE.test(args.reviewerId)) {
    throw new Error('transitionReceiptStatus: reviewerId must be a UUID');
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
    WHERE id = ${args.id}
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
  return rows[0] ?? null;
}

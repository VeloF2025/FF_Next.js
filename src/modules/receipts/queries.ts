/**
 * SQL helpers for the staff_receipts module.
 *
 * Visibility model:
 *   - Staff at /my/receipts see rows where staff_id = their session.
 *   - Finance at /staff/receipts (Phase 2) sees rows across staff
 *     (gated by receipts.review permission).
 *
 * DATE columns are projected through to_char() so they come back as
 * YYYY-MM-DD strings — pg's default JS-Date conversion uses server-local
 * midnight which JSON-serialises to UTC and silently shifts a day in SAST.
 */

import { sql } from '@/lib/db-pool';

import type { ReceiptCategory } from './categories';

export type ReceiptStatus = 'submitted' | 'approved' | 'rejected' | 'reconciled';
export type PaymentMethod = 'company_card' | 'personal_reimbursement';

export interface ReceiptRow extends Record<string, unknown> {
  id: string;
  staff_id: string;
  receipt_date: string;          // YYYY-MM-DD
  vendor: string | null;
  total_cents: string;            // bigint comes back as text from pg
  vat_cents: string | null;
  currency: string;
  category: ReceiptCategory;
  description: string | null;
  payment_method: PaymentMethod;
  project_id: string | null;
  vehicle_assignment_id: string | null;
  image_url: string;
  image_mime: string;
  captured_lat: string | null;
  captured_lon: string | null;
  captured_at: string;
  ocr_raw: Record<string, unknown> | null;
  ocr_category_guess: string | null;
  ocr_confidence: string | null;  // numeric → text
  status: ReceiptStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsertReceiptArgs {
  id: string;                     // pre-generated UUID so the image filename matches
  staffId: string;
  receiptDate: string;            // YYYY-MM-DD
  vendor: string | null;
  totalCents: number;
  vatCents: number | null;
  currency?: string;              // defaults to 'ZAR'
  category: ReceiptCategory;
  description: string | null;
  paymentMethod: PaymentMethod;
  projectId: string | null;
  vehicleAssignmentId: string | null;
  imageUrl: string;
  imageMime: string;
  capturedLat: number | null;
  capturedLon: number | null;
  ocrRaw: Record<string, unknown> | null;
  ocrCategoryGuess: string | null;
  ocrConfidence: number | null;
}

export async function insertReceipt(args: InsertReceiptArgs): Promise<ReceiptRow> {
  const rows = await sql<ReceiptRow>`
    INSERT INTO staff_receipts (
      id, staff_id, receipt_date, vendor,
      total_cents, vat_cents, currency,
      category, description, payment_method,
      project_id, vehicle_assignment_id,
      image_url, image_mime,
      captured_lat, captured_lon,
      ocr_raw, ocr_category_guess, ocr_confidence
    ) VALUES (
      ${args.id}, ${args.staffId}, ${args.receiptDate}, ${args.vendor},
      ${args.totalCents}, ${args.vatCents}, ${args.currency ?? 'ZAR'},
      ${args.category}, ${args.description}, ${args.paymentMethod},
      ${args.projectId}, ${args.vehicleAssignmentId},
      ${args.imageUrl}, ${args.imageMime},
      ${args.capturedLat}, ${args.capturedLon},
      ${args.ocrRaw ? JSON.stringify(args.ocrRaw) : null},
      ${args.ocrCategoryGuess}, ${args.ocrConfidence}
    )
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
  if (!rows[0]) throw new Error('insertReceipt returned no row');
  return rows[0];
}

/**
 * List a staff member's own receipts, latest first. Excludes rejected
 * (those failed review and shouldn't reappear in the staff inbox).
 */
export async function listReceiptsForStaff(
  staffId: string,
  limit = 60
): Promise<ReceiptRow[]> {
  return sql<ReceiptRow>`
    SELECT
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
    FROM staff_receipts
    WHERE staff_id = ${staffId}
      AND status != 'rejected'
    ORDER BY receipt_date DESC, created_at DESC
    LIMIT ${limit}
  `;
}

/**
 * Find one receipt by id, scoped to a staff member.
 *
 * Pass `staffIdScope` for /my/receipts paths — returns null when the
 * receipt belongs to someone else (no IDOR via direct ID access). Pass
 * null only from admin code paths gated by receipts.review.
 */
export async function findReceiptById(
  id: string,
  staffIdScope: string | null
): Promise<ReceiptRow | null> {
  const rows = staffIdScope
    ? await sql<ReceiptRow>`
        SELECT
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
        FROM staff_receipts
        WHERE id = ${id}
          AND staff_id = ${staffIdScope}
        LIMIT 1
      `
    : await sql<ReceiptRow>`
        SELECT
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
        FROM staff_receipts
        WHERE id = ${id}
        LIMIT 1
      `;
  return rows[0] ?? null;
}

/**
 * Latest non-rejected receipt for the hub tile badge.
 * Returns just the bits the badge needs.
 */
export async function findLatestReceiptForStaff(staffId: string): Promise<{
  id: string;
  vendor: string | null;
  totalCents: number;
  capturedAt: string;
} | null> {
  const rows = await sql<{
    id: string;
    vendor: string | null;
    total_cents: string;
    captured_at: string;
  }>`
    SELECT id, vendor, total_cents, captured_at
    FROM staff_receipts
    WHERE staff_id = ${staffId}
      AND status != 'rejected'
    ORDER BY captured_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    vendor: row.vendor,
    totalCents: Number(row.total_cents),
    capturedAt: row.captured_at,
  };
}

export interface UpdateReceiptArgs {
  id: string;
  staffIdScope: string;            // staff can only edit their own
  receiptDate?: string;
  vendor?: string | null;
  totalCents?: number;
  vatCents?: number | null;
  category?: ReceiptCategory;
  description?: string | null;
  paymentMethod?: PaymentMethod;
  projectId?: string | null;
}

/**
 * Patch an editable receipt. Returns null if the row doesn't exist,
 * doesn't belong to the staff, OR is no longer in 'submitted' status
 * (locks once finance has acted on it).
 */
export async function updateOwnSubmittedReceipt(args: UpdateReceiptArgs): Promise<ReceiptRow | null> {
  const rows = await sql<ReceiptRow>`
    UPDATE staff_receipts
    SET
      receipt_date    = COALESCE(${args.receiptDate ?? null}, receipt_date),
      vendor          = COALESCE(${args.vendor ?? null}, vendor),
      total_cents     = COALESCE(${args.totalCents ?? null}, total_cents),
      vat_cents       = ${args.vatCents !== undefined ? args.vatCents : sql`vat_cents`},
      category        = COALESCE(${args.category ?? null}, category),
      description     = ${args.description !== undefined ? args.description : sql`description`},
      payment_method  = COALESCE(${args.paymentMethod ?? null}, payment_method),
      project_id      = ${args.projectId !== undefined ? args.projectId : sql`project_id`},
      updated_at      = NOW()
    WHERE id = ${args.id}
      AND staff_id = ${args.staffIdScope}
      AND status = 'submitted'
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

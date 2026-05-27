/**
 * SQL helpers for the payslips module (PRD-040 Phase 3).
 *
 * Split out of the API handlers so the route files stay focused on HTTP
 * concerns. Test mocks target these helpers instead of duplicating SQL.
 *
 * Visibility model:
 *   - Staff at /my/payslips see rows where staff_id = their session AND
 *     archived_at IS NULL.
 *   - HR at /staff/payslips sees rows across all staff (gated by
 *     payslips.import permission).
 *   - The retention job sets archived_at on rows whose pay_period_end
 *     has aged out (>5y); the row itself is preserved for audit.
 */

import { sql } from '@/lib/db-pool';

export interface PayslipRow extends Record<string, unknown> {
  id: string;
  staff_id: string;
  pay_period_start: string;        // ISO date 'YYYY-MM-DD'
  pay_period_end: string;          // ISO date 'YYYY-MM-DD'
  gross_cents: string;             // bigint comes back as text
  deductions_cents: string;
  net_cents: string;
  pdf_url: string | null;
  raw_data: Record<string, unknown> | null;
  imported_at: string;
  imported_by: string | null;
  archived_at: string | null;
}

export interface InsertPayslipArgs {
  staffId: string;
  payPeriodStart: string;          // 'YYYY-MM-DD'
  payPeriodEnd: string;
  grossCents: number;
  deductionsCents: number;
  netCents: number;
  pdfUrl: string | null;
  rawData: Record<string, unknown> | null;
  importedBy: string | null;
}

/**
 * Insert or update a payslip for one staff/period. Re-uploading the same
 * period overwrites the prior row (intentional — HR may correct an
 * imported payslip without manual cleanup). archived_at is preserved on
 * conflict so a re-import doesn't un-archive an aged-out row.
 */
export async function upsertPayslip(args: InsertPayslipArgs): Promise<PayslipRow> {
  const rows = await sql<PayslipRow>`
    INSERT INTO payslips (
      staff_id,
      pay_period_start, pay_period_end,
      gross_cents, deductions_cents, net_cents,
      pdf_url, raw_data, imported_by
    ) VALUES (
      ${args.staffId},
      ${args.payPeriodStart}, ${args.payPeriodEnd},
      ${args.grossCents}, ${args.deductionsCents}, ${args.netCents},
      ${args.pdfUrl}, ${args.rawData ? JSON.stringify(args.rawData) : null}, ${args.importedBy}
    )
    ON CONFLICT (staff_id, pay_period_start, pay_period_end) DO UPDATE
    SET gross_cents      = EXCLUDED.gross_cents,
        deductions_cents = EXCLUDED.deductions_cents,
        net_cents        = EXCLUDED.net_cents,
        pdf_url          = COALESCE(EXCLUDED.pdf_url, payslips.pdf_url),
        raw_data         = COALESCE(EXCLUDED.raw_data, payslips.raw_data),
        imported_at      = NOW(),
        imported_by      = EXCLUDED.imported_by
    RETURNING *
  `;
  if (!rows[0]) throw new Error('upsertPayslip returned no row');
  return rows[0];
}

/**
 * List a staff member's own active payslips, latest period first.
 * Hits idx_payslips_staff_active for an index-only scan in the common case.
 *
 * DATE columns are projected through to_char() so they come back as
 * YYYY-MM-DD strings — pg's default JS-Date conversion uses server-local
 * midnight which JSON-serialises to UTC and silently shifts a day in SAST.
 */
export async function listPayslipsForStaff(
  staffId: string,
  limit = 60
): Promise<PayslipRow[]> {
  return sql<PayslipRow>`
    SELECT
      id,
      staff_id,
      to_char(pay_period_start, 'YYYY-MM-DD') AS pay_period_start,
      to_char(pay_period_end,   'YYYY-MM-DD') AS pay_period_end,
      gross_cents,
      deductions_cents,
      net_cents,
      pdf_url,
      raw_data,
      imported_at,
      imported_by,
      archived_at
    FROM payslips
    WHERE staff_id = ${staffId}
      AND archived_at IS NULL
    ORDER BY pay_period_start DESC
    LIMIT ${limit}
  `;
}

/**
 * Find one payslip by id, scoped to a staff member.
 *
 * Pass `staffIdScope` for the /my/payslips download flow — returns null
 * when the payslip belongs to someone else (no IDOR on direct ID access).
 * Pass null only from admin code paths gated by payslips.import.
 */
export async function findPayslipById(
  id: string,
  staffIdScope: string | null
): Promise<PayslipRow | null> {
  const rows = staffIdScope
    ? await sql<PayslipRow>`
        SELECT
          id,
          staff_id,
          to_char(pay_period_start, 'YYYY-MM-DD') AS pay_period_start,
          to_char(pay_period_end,   'YYYY-MM-DD') AS pay_period_end,
          gross_cents,
          deductions_cents,
          net_cents,
          pdf_url,
          raw_data,
          imported_at,
          imported_by,
          archived_at
        FROM payslips
        WHERE id = ${id}
          AND staff_id = ${staffIdScope}
          AND archived_at IS NULL
        LIMIT 1
      `
    : await sql<PayslipRow>`
        SELECT
          id,
          staff_id,
          to_char(pay_period_start, 'YYYY-MM-DD') AS pay_period_start,
          to_char(pay_period_end,   'YYYY-MM-DD') AS pay_period_end,
          gross_cents,
          deductions_cents,
          net_cents,
          pdf_url,
          raw_data,
          imported_at,
          imported_by,
          archived_at
        FROM payslips
        WHERE id = ${id}
        LIMIT 1
      `;
  return rows[0] ?? null;
}

/**
 * Latest active payslip for the hub tile badge (PRD-040 hub-summary endpoint).
 * Returns just the bits the badge needs — period + presence of a downloadable PDF.
 */
export async function findLatestPayslipForStaff(staffId: string): Promise<{
  id: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  hasPdf: boolean;
} | null> {
  // pg driver returns DATE columns as JS Date at server-local midnight,
  // which JSON-serializes as a UTC ISO string and shifts the day in SAST.
  // Format as YYYY-MM-DD strings server-side so the client gets the
  // pay-period day exactly as HR entered it.
  const rows = await sql<{
    id: string;
    pay_period_start: string;
    pay_period_end: string;
    has_pdf: boolean;
  }>`
    SELECT id,
           to_char(pay_period_start, 'YYYY-MM-DD') AS pay_period_start,
           to_char(pay_period_end,   'YYYY-MM-DD') AS pay_period_end,
           pdf_url IS NOT NULL AS has_pdf
    FROM payslips
    WHERE staff_id = ${staffId}
      AND archived_at IS NULL
    ORDER BY pay_period_start DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    payPeriodStart: row.pay_period_start,
    payPeriodEnd: row.pay_period_end,
    hasPdf: row.has_pdf,
  };
}

/**
 * Retention job entry point — archive payslips whose pay_period_end is older
 * than the configured horizon (5 years per PRD-040 Phase 3 decisions). The
 * row is preserved; only archived_at is set, hiding it from staff but
 * leaving it queryable for audit.
 *
 * Returns the number of rows archived. Idempotent — already-archived rows
 * are not touched.
 */
export async function archiveAgedPayslips(asOf: Date = new Date()): Promise<number> {
  const cutoff = new Date(asOf);
  cutoff.setFullYear(cutoff.getFullYear() - 5);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const rows = await sql<{ id: string }>`
    UPDATE payslips
    SET archived_at = NOW()
    WHERE archived_at IS NULL
      AND pay_period_end < ${cutoffIso}
    RETURNING id
  `;
  return rows.length;
}

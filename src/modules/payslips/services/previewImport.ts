/**
 * Preview phase of the combined-PDF importer.
 *
 * Splits the uploaded PDF, auto-matches each page to a staff record, joins
 * against existing payslips for the period to derive per-row state, and
 * pulls the staff list + period skip history needed by the UI. Pure read —
 * never writes to the DB or to VF Storage.
 */

import { sql } from '@/lib/db-pool';

import { matchPagesToStaff, type StaffMatchResult } from '../staffMatcher';
import {
  splitCombinedPayslipPdf,
  periodToDateRange,
  type ExtractedPayslipPage,
} from '../pdfSplitter';
import { deriveRowState } from '../rowState';
import type {
  ExistingPayslipSummary,
  ManualMapping,
  PeriodSkip,
  PreviewRow,
  StaffOption,
} from '../types';

export interface PreviewImportInput {
  buffer: Buffer;
  manualMappings: ManualMapping[];
  /** Already-resolved casual creates (only used at commit; for preview we
   *  mirror manualMappings into matches so HR sees what it'll look like). */
  casualMatchOverrides?: Map<number, StaffMatchResult>;
}

export interface PreviewImportResult {
  period: string | null;
  numPages: number;
  pages: ExtractedPayslipPage[];
  matches: Map<number, StaffMatchResult>;
  previewRows: PreviewRow[];
  staffOptions: StaffOption[];
  periodSkips: PeriodSkip[];
  /** Existing payslips for the period, keyed by staffId (for commit phase). */
  existingByStaff: Map<string, ExistingPayslipSummary>;
}

export async function runPreviewImport(
  input: PreviewImportInput
): Promise<PreviewImportResult> {
  const split = await splitCombinedPayslipPdf(input.buffer);
  const matches = await matchPagesToStaff(split.pages);

  // Apply casual-match overrides first (commit-only path) so manual mappings
  // can still override on the same row.
  if (input.casualMatchOverrides) {
    for (const [pageNum, match] of input.casualMatchOverrides) {
      matches.set(pageNum, match);
    }
  }

  if (input.manualMappings.length > 0) {
    const wantedIds = Array.from(
      new Set(input.manualMappings.map((m) => m.staffId))
    );
    const staffRows = await sql<{
      id: string;
      first_name: string;
      last_name: string;
      email: string;
    }>`
      SELECT id, first_name, last_name, LOWER(email) AS email
      FROM staff
      WHERE id = ANY(${wantedIds}::uuid[])
        AND status IS DISTINCT FROM 'archived'
    `;
    const staffById = new Map(staffRows.map((r) => [r.id, r]));
    for (const mapping of input.manualMappings) {
      const row = staffById.get(mapping.staffId);
      if (!row) {
        throw new Error(
          `Manual mapping for page ${mapping.page} references unknown or archived staff id ${mapping.staffId}.`
        );
      }
      matches.set(mapping.page, {
        staffId: row.id,
        staffName: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
        staffEmail: row.email,
        method: 'unmatched',
        confidence: 1,
      });
    }
  }

  const range = split.period ? periodToDateRange(split.period) : null;
  const matchedStaffIds = Array.from(
    new Set(
      Array.from(matches.values())
        .map((m) => m.staffId)
        .filter((id): id is string => Boolean(id))
    )
  );

  let existingByStaff: Map<string, ExistingPayslipSummary> = new Map();
  if (range && matchedStaffIds.length > 0) {
    const rows = await sql<{
      id: string;
      staff_id: string;
      gross_cents: string;
      deductions_cents: string;
      net_cents: string;
      pdf_url: string | null;
      imported_at: string;
    }>`
      SELECT id, staff_id, gross_cents, deductions_cents, net_cents, pdf_url, imported_at
      FROM payslips
      WHERE staff_id = ANY(${matchedStaffIds}::uuid[])
        AND pay_period_start = ${range.start}
        AND pay_period_end = ${range.end}
    `;
    existingByStaff = new Map(
      rows.map((r) => [
        r.staff_id,
        {
          id: r.id,
          importedAt: r.imported_at,
          grossCents: Number(r.gross_cents),
          deductionsCents: Number(r.deductions_cents),
          netCents: Number(r.net_cents),
          hasPdf: r.pdf_url !== null,
          pdfStoredFilename: r.pdf_url ? extractStoredFilename(r.pdf_url) : null,
        },
      ])
    );
  }

  const periodSkipRows = split.period
    ? await sql<{
        id: string;
        emp_code: string;
        emp_name: string | null;
        reason: string | null;
        skipped_at: string;
        resolved_at: string | null;
      }>`
        SELECT id, emp_code, emp_name, reason, skipped_at, resolved_at
        FROM payslip_import_skips
        WHERE pay_period = ${split.period}
        ORDER BY skipped_at ASC
      `
    : [];
  const skipByEmpCode = new Map(
    periodSkipRows
      .filter((s) => s.resolved_at === null)
      .map((s) => [s.emp_code, s])
  );

  const staffList = await sql<{
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    employment_type: string;
  }>`
    SELECT id, first_name, last_name, LOWER(email) AS email, employment_type
    FROM staff
    WHERE status IS DISTINCT FROM 'archived'
    ORDER BY last_name ASC, first_name ASC
  `;
  const staffOptions: StaffOption[] = staffList.map((s) => ({
    id: s.id,
    fullName: `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim(),
    email: s.email,
    employmentType: s.employment_type === 'casual' ? 'casual' : 'permanent',
  }));

  const previewRows: PreviewRow[] = split.pages.map((page) => {
    const match = matches.get(page.page) ?? {
      staffId: null,
      staffName: null,
      staffEmail: null,
      method: 'unmatched' as const,
      confidence: 0,
    };
    const existing = match.staffId
      ? existingByStaff.get(match.staffId) ?? null
      : null;
    const previousSkipRow = page.empCode
      ? skipByEmpCode.get(page.empCode) ?? null
      : null;
    const previousSkip = previousSkipRow
      ? {
          id: previousSkipRow.id,
          reason: previousSkipRow.reason,
          skippedAt: previousSkipRow.skipped_at,
        }
      : null;
    return {
      page: page.page,
      empCode: page.empCode,
      empName: page.empName,
      idNumber: page.idNumber,
      totalEarningsCents: page.totalEarningsCents,
      totalDeductionsCents: page.totalDeductionsCents,
      nettPayCents: page.nettPayCents,
      match,
      rowState: deriveRowState({
        match,
        existing,
        previousSkip,
        totalEarningsCents: page.totalEarningsCents,
        totalDeductionsCents: page.totalDeductionsCents,
        nettPayCents: page.nettPayCents,
      }),
      existingPayslip: existing,
      previousSkip,
    };
  });

  const periodSkipsForResponse: PeriodSkip[] = periodSkipRows.map((s) => ({
    id: s.id,
    empCode: s.emp_code,
    empName: s.emp_name,
    reason: s.reason,
    skippedAt: s.skipped_at,
    resolvedAt: s.resolved_at,
  }));

  return {
    period: split.period,
    numPages: split.numPages,
    pages: split.pages,
    matches,
    previewRows,
    staffOptions,
    periodSkips: periodSkipsForResponse,
    existingByStaff,
  };
}

/**
 * VF Storage URLs look like /storage/staff/payslips/<hashed-filename>.pdf.
 * The delete API needs just the filename portion; this helper extracts it.
 */
export function extractStoredFilename(pdfUrl: string): string | null {
  const m = pdfUrl.match(/\/staff\/payslips\/([^/?#]+)$/);
  return m?.[1] ?? null;
}

/**
 * Shared types for the payslips module — used by both the API route and
 * the HR-side import page. Lives in src/modules/payslips/ rather than next
 * to either consumer so that the page and the API can't drift on shape.
 */

/**
 * Per-row state on the combined-PDF import preview.
 *
 * - new                 — staff matched, no payslip exists for this period
 * - already_imported    — staff matched, payslip exists with identical amounts
 * - matched_changed     — staff matched, payslip exists but amounts differ
 *                         (e.g. HR re-ran payroll for a correction)
 * - unmatched           — no staff resolved (auto-match + manual map both empty)
 * - previously_skipped  — no staff, but a prior import for this period
 *                         already wrote a skip row for this empCode
 */
export type RowState =
  | 'new'
  | 'already_imported'
  | 'matched_changed'
  | 'unmatched'
  | 'previously_skipped';

export type MatchMethod =
  | 'payroll_code'
  | 'id_number'
  | 'sa_id_number'
  | 'name_fuzzy'
  | 'unmatched';

export interface StaffMatchSummary {
  staffId: string | null;
  staffName: string | null;
  staffEmail: string | null;
  method: MatchMethod;
  /** 0..1 — only meaningful for `name_fuzzy`; 1.0 for the exact-match methods. */
  confidence: number;
}

export interface ExistingPayslipSummary {
  id: string;
  importedAt: string;
  grossCents: number;
  deductionsCents: number;
  netCents: number;
  hasPdf: boolean;
  /** Hashed VF Storage filename, used to delete the old PDF on overwrite. */
  pdfStoredFilename: string | null;
}

export interface PreviousSkipSummary {
  id: string;
  reason: string | null;
  skippedAt: string;
}

export interface PreviewRow {
  page: number;
  empCode: string | null;
  empName: string | null;
  idNumber: string | null;
  totalEarningsCents: number | null;
  totalDeductionsCents: number | null;
  nettPayCents: number | null;
  match: StaffMatchSummary;
  rowState: RowState;
  existingPayslip: ExistingPayslipSummary | null;
  previousSkip: PreviousSkipSummary | null;
}

export interface StaffOption {
  id: string;
  fullName: string;
  email: string;
  employmentType: 'permanent' | 'casual';
}

export interface PeriodSkip {
  id: string;
  empCode: string;
  empName: string | null;
  reason: string | null;
  skippedAt: string;
  resolvedAt: string | null;
}

export interface CombinedImportResponse {
  period: string | null;
  numPages: number;
  pages: PreviewRow[];
  staffOptions: StaffOption[];
  periodSkips: PeriodSkip[];
  /** True only after a commit phase. */
  committed: boolean;
  insertedCount: number;
  updatedCount: number;
  unchangedSkipped: number;
  manualSkippedCount: number;
  casualsCreated: number;
  payrollCodesSaved: number;
}

export interface ManualMapping {
  page: number;
  staffId: string;
  savePayrollCode?: boolean;
}

export interface CasualCreate {
  page: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  employmentType?: 'permanent' | 'casual';
}

export interface SkipRequest {
  page: number;
  reason?: string;
}

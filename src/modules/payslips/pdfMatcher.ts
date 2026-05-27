/**
 * Match uploaded PDFs to parsed CSV rows by filename.
 *
 * The CSV is the authoritative source of truth for what should be imported.
 * PDFs are optional supporting attachments — if a PDF can't be matched,
 * the row still imports (with pdf_url = NULL) and the staff sees a
 * "No PDF" pill on /my/payslips.
 *
 * Match heuristics, in order (first hit wins):
 *
 *   1. Filename contains the staff's email (full).
 *   2. Filename contains the staff's email local-part (before '@').
 *   3. Filename contains "firstname.lastname" or "firstname-lastname"
 *      or "firstname_lastname" (case-insensitive).
 *
 * For each candidate match, the filename must ALSO encode the period —
 * either as YYYY-MM (the canonical month) or YYYY-MM-DD that falls
 * within the row's period. This stops "april payslip" PDFs from being
 * accidentally matched against the May row for the same staff.
 */

import type { ParsedPayslipRow } from './csvParser';

export interface PdfFile {
  /** Original filename as uploaded. */
  originalName: string;
  /** Path used for de-duplication / uniqueness. */
  tmpPath: string;
  size: number;
}

export interface PdfMatch {
  row: ParsedPayslipRow;
  pdf: PdfFile;
}

export interface MatchResult {
  /** Rows matched to a PDF — ready to import with pdf_url. */
  matched: PdfMatch[];
  /** Rows that parsed cleanly but had no PDF attached — import with pdf_url=NULL. */
  rowsWithoutPdf: ParsedPayslipRow[];
  /** PDFs the matcher couldn't tie to any row — surfaced in the preview. */
  unmatchedPdfs: PdfFile[];
}

export function matchPdfsToRows(
  rows: ParsedPayslipRow[],
  pdfs: PdfFile[]
): MatchResult {
  const matched: PdfMatch[] = [];
  const consumedPdfPaths = new Set<string>();

  for (const row of rows) {
    const pdf = pickPdfForRow(row, pdfs, consumedPdfPaths);
    if (pdf) {
      consumedPdfPaths.add(pdf.tmpPath);
      matched.push({ row, pdf });
    }
  }

  const matchedRowIndices = new Set(matched.map((m) => m.row.rowIndex));
  const rowsWithoutPdf = rows.filter((r) => !matchedRowIndices.has(r.rowIndex));
  const unmatchedPdfs = pdfs.filter((p) => !consumedPdfPaths.has(p.tmpPath));

  return { matched, rowsWithoutPdf, unmatchedPdfs };
}

function pickPdfForRow(
  row: ParsedPayslipRow,
  pdfs: PdfFile[],
  alreadyConsumed: Set<string>
): PdfFile | null {
  const candidates = pdfs.filter((p) => !alreadyConsumed.has(p.tmpPath));
  const periodTokens = periodTokensForRow(row);
  const localPart = row.email.split('@')[0]?.toLowerCase() ?? '';
  const fullEmail = row.email.toLowerCase();

  // Strategy 1 + period
  for (const pdf of candidates) {
    const name = pdf.originalName.toLowerCase();
    if (name.includes(fullEmail) && periodMatches(name, periodTokens)) {
      return pdf;
    }
  }

  // Strategy 2 + period (and minimum 4-char local-part to avoid "ben" matching "Bennett")
  if (localPart.length >= 4) {
    for (const pdf of candidates) {
      const name = pdf.originalName.toLowerCase();
      if (name.includes(localPart) && periodMatches(name, periodTokens)) {
        return pdf;
      }
    }
  }

  // Strategy 3 + period
  if (row.firstName && row.lastName) {
    const first = row.firstName.toLowerCase();
    const last = row.lastName.toLowerCase();
    const nameTokens = [
      `${first}.${last}`,
      `${first}-${last}`,
      `${first}_${last}`,
      `${first} ${last}`,
    ];
    for (const pdf of candidates) {
      const name = pdf.originalName.toLowerCase();
      if (
        nameTokens.some((token) => name.includes(token)) &&
        periodMatches(name, periodTokens)
      ) {
        return pdf;
      }
    }
  }

  return null;
}

/**
 * Build the set of period strings that should appear in a matching PDF
 * filename. Includes the canonical YYYY-MM (start month), and YYYY-MM
 * for the end month if it differs. The day-level YYYY-MM-DD start/end
 * are also accepted for HR who export filenames per pay run.
 */
function periodTokensForRow(row: ParsedPayslipRow): string[] {
  const tokens = new Set<string>();
  tokens.add(row.payPeriodStart);
  tokens.add(row.payPeriodEnd);
  tokens.add(row.payPeriodStart.slice(0, 7));
  tokens.add(row.payPeriodEnd.slice(0, 7));
  return Array.from(tokens);
}

function periodMatches(filename: string, tokens: string[]): boolean {
  return tokens.some((t) => filename.includes(t));
}

/**
 * Match a combined-PDF page to a staff record.
 *
 * Match priority (most reliable first):
 *   1. payroll_code  — exact (HR's previous manual mapping is remembered).
 *   2. id_number     — exact 13-digit RSA ID.
 *   3. sa_id_number  — same data on a different column where some staff
 *                      have it filled in.
 *   4. name fuzzy    — first-initial + lowercased last-name compared against
 *                      `LEFT(first_name,1) || ' ' || last_name`.
 *
 * Anything that doesn't match by step 4 is returned as 'unmatched' — the
 * UI then shows a manual-map dropdown so HR can pick the staff member,
 * optionally persisting `staff.payroll_code` for next month.
 */

import { sql } from '@/lib/db-pool';

import type { ExtractedPayslipPage } from './pdfSplitter';

export type MatchMethod =
  | 'payroll_code'
  | 'id_number'
  | 'sa_id_number'
  | 'name_fuzzy'
  | 'unmatched';

export interface StaffMatchResult {
  staffId: string | null;
  staffName: string | null;
  staffEmail: string | null;
  method: MatchMethod;
  /** 0..1 — only meaningful for name_fuzzy; 1.0 for the exact-match methods. */
  confidence: number;
}

interface StaffRow extends Record<string, unknown> {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  id_number: string | null;
  sa_id_number: string | null;
  payroll_code: string | null;
}

/**
 * Resolve every page in a single batch — one SELECT for all staff, then
 * O(pages × staff) matching in memory. The staff table has ~80 rows, so
 * this stays under a millisecond. Avoids hammering pg with 39 queries.
 */
export async function matchPagesToStaff(
  pages: ExtractedPayslipPage[]
): Promise<Map<number, StaffMatchResult>> {
  const staff = await sql<StaffRow>`
    SELECT id,
           LOWER(email) AS email,
           first_name,
           last_name,
           id_number,
           sa_id_number,
           payroll_code
    FROM staff
    WHERE status IS DISTINCT FROM 'archived'
  `;

  const byPayrollCode = new Map<string, StaffRow>();
  const byIdNumber = new Map<string, StaffRow>();
  const bySaIdNumber = new Map<string, StaffRow>();
  for (const s of staff) {
    if (s.payroll_code) byPayrollCode.set(s.payroll_code.toUpperCase(), s);
    if (s.id_number) byIdNumber.set(s.id_number, s);
    if (s.sa_id_number) bySaIdNumber.set(s.sa_id_number, s);
  }

  const out = new Map<number, StaffMatchResult>();
  for (const page of pages) {
    out.set(page.page, matchOne(page, staff, byPayrollCode, byIdNumber, bySaIdNumber));
  }
  return out;
}

function matchOne(
  page: ExtractedPayslipPage,
  staff: StaffRow[],
  byPayrollCode: Map<string, StaffRow>,
  byIdNumber: Map<string, StaffRow>,
  bySaIdNumber: Map<string, StaffRow>
): StaffMatchResult {
  if (page.empCode) {
    const hit = byPayrollCode.get(page.empCode.toUpperCase());
    if (hit) return makeResult(hit, 'payroll_code', 1);
  }
  if (page.idNumber) {
    const hit = byIdNumber.get(page.idNumber) ?? bySaIdNumber.get(page.idNumber);
    if (hit) {
      return makeResult(
        hit,
        hit.id_number === page.idNumber ? 'id_number' : 'sa_id_number',
        1
      );
    }
  }
  if (page.firstInitial && page.lastName) {
    const candidates: Array<{ row: StaffRow; score: number }> = [];
    const wantInitial = page.firstInitial.toUpperCase();
    const wantLast = page.lastName.toLowerCase();
    for (const s of staff) {
      const first = (s.first_name ?? '').trim();
      const last = (s.last_name ?? '').trim().toLowerCase();
      if (!first || !last) continue;
      const initial = first[0]!.toUpperCase();
      const lastScore = stringSimilarity(wantLast, last);
      // Initial must match exactly — otherwise we'd false-match Mr B Viviers
      // to any other staff whose last name is close to "Viviers".
      if (initial !== wantInitial) continue;
      if (lastScore >= 0.85) candidates.push({ row: s, score: lastScore });
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    // Require a clear winner — if the second-best is within 0.05 we abstain
    // and let HR map manually. Avoids flipping a coin between siblings.
    if (
      best &&
      (candidates.length === 1 || candidates[1]!.score < best.score - 0.05)
    ) {
      return makeResult(best.row, 'name_fuzzy', best.score);
    }
  }
  return {
    staffId: null,
    staffName: null,
    staffEmail: null,
    method: 'unmatched',
    confidence: 0,
  };
}

function makeResult(
  row: StaffRow,
  method: MatchMethod,
  confidence: number
): StaffMatchResult {
  return {
    staffId: row.id,
    staffName: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
    staffEmail: row.email,
    method,
    confidence,
  };
}

/**
 * Normalised Levenshtein similarity in [0, 1]. Implemented inline rather
 * than pulling a dependency for one call site.
 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1]! + 1,
        prev[j]! + 1,
        prev[j - 1]! + cost
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

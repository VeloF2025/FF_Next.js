/**
 * Field extraction for the two payslip layouts Sage produces.
 *
 * VIP (legacy, up to June 2026) prints `Label  value` left-to-right and
 * separates thousands with commas:
 *
 *     Emp Code  AC001        Payment Dt  2026/04/30
 *     NETT PAY  21,400.88
 *
 * Plain Paper (current, from July 2026) prints `value  Label`, and pdfjs
 * emits each line right-to-left — so the value arrives *before* its label.
 * Thousands are separated with spaces, and long names wrap onto their own
 * lines with a "known as" name in parentheses:
 *
 *     AC002\tEmployee Code\tJANE DOE (JANE)\tEmployee
 *     3 558.12\tTotal deductions\t25 000.00\tTotal earnings
 *
 * Both layouts stay supported so previously-exported months can still be
 * re-imported. `detectLayout` picks per page; add a new branch here rather
 * than loosening the existing anchors — a regex that matches both layouts
 * loosely is how you silently import the wrong number.
 */

import { matchOne, parseRandToCents, splitName } from './payslipParsing';

export type PayslipLayout = 'vip' | 'plain_paper';

export interface ExtractedFields {
  empCode: string | null;
  empName: string | null;
  firstInitial: string | null;
  lastName: string | null;
  idNumber: string | null;
  paymentDate: string | null;
  totalEarningsCents: number | null;
  totalDeductionsCents: number | null;
  nettPayCents: number | null;
}

/**
 * "Employee Code" is unique to the Plain Paper template — VIP spells it
 * "Emp Code" — so it is a safe discriminator. Unknown/blank pages fall back
 * to VIP, which yields all-null fields exactly as before.
 */
export function detectLayout(text: string): PayslipLayout {
  return /\bEmployee\s+Code\b/i.test(text) ? 'plain_paper' : 'vip';
}

export function extractFields(text: string, layout: PayslipLayout): ExtractedFields {
  return layout === 'plain_paper' ? extractPlainPaper(text) : extractVip(text);
}

// ─── Plain Paper (current) ───────────────────────────────────────────

/**
 * A rand amount sitting immediately before its label, e.g. "25 000.00\tTotal
 * earnings". The thousands separator may be a plain space or a non-breaking /
 * narrow no-break space depending on the generator, so all three are allowed
 * inside the number — but deliberately NOT `\s`, which would let the capture
 * bridge a tab or newline and pick up a number from the neighbouring column.
 */
const PLAIN_TOTAL_EARNINGS =
  /([\d,\u00a0\u202f ]+\.\d{2})[\u00a0\u202f ]*\t[ ]*Total\s+earnings\b/i;
const PLAIN_NETT_PAY =
  /([\d,\u00a0\u202f ]+\.\d{2})[\u00a0\u202f ]*\t[ ]*Nett\s+pay\b/i;

// The tab is required in each of these - it is what separates the value cell
// from the label cell, and without it a bare number on the preceding line
// could be picked up instead.
const PLAIN_EMP_CODE =
  /(?:^|\t)[ ]*([A-Za-z0-9][A-Za-z0-9-]*)[ ]*\t[ ]*Employee\s+Code\b/im;
const PLAIN_ID_NUMBER = /(\d{13})[ ]*\t[ ]*Identity\s+Number\b/i;
const PLAIN_PAY_DATE = /(\d{4}\/\d{2}\/\d{2})[ ]*\t[ ]*Pay\s+Date\b/i;

/**
 * The bare "Employee" label that closes the name block. Anchored to the end of
 * its line: "Employee" also occurs inside "Employee Code", and a future
 * template could add an "Employee Type"/"Employee Status" field - a plain
 * `\bEmployee\b` terminator would stop at whichever came first and silently
 * truncate the name. Confirmed line-final on all 42 pages of the July export.
 */
const PLAIN_NAME_END = /\bEmployee[ \t]*$/im;

/** The name block: everything between the code label and that terminator. */
const PLAIN_NAME_SPAN = /Employee\s+Code\b([\s\S]{0,120}?)\bEmployee[ \t]*$/im;

function extractPlainPaper(text: string): ExtractedFields {
  const empCode = matchOne(text, PLAIN_EMP_CODE);
  const idNumber = matchOne(text, PLAIN_ID_NUMBER);
  const paymentDate = matchOne(text, PLAIN_PAY_DATE);

  // "Total earnings" - never "Taxable earnings", which is the YTD figure and
  // is larger, so a loose anchor imports a wildly wrong gross.
  const totalEarningsCents = parseRandToCents(matchOne(text, PLAIN_TOTAL_EARNINGS));
  const nettPayCents = parseRandToCents(matchOne(text, PLAIN_NETT_PAY));

  // Derived, not read off the page — same as VIP. `commitImport` relies on
  // deductions being null only when earnings or nett is also null (it defaults
  // a null to 0 when writing the row), so an independently-parsed deductions
  // field that could fail on its own would let a 0 overwrite a correct stored
  // value on re-import. Deriving also guarantees gross - deductions == net on
  // every row. Verified against the July 2026 export: the derived figure equals
  // Sage's printed "Total deductions" on all 42 pages.
  const totalDeductionsCents =
    totalEarningsCents !== null && nettPayCents !== null
      ? totalEarningsCents - nettPayCents
      : null;

  const empName = extractPlainPaperName(text);

  return {
    empCode,
    empName,
    ...splitName(empName),
    idNumber,
    paymentDate,
    totalEarningsCents,
    totalDeductionsCents,
    nettPayCents,
  };
}

/**
 * The name occupies everything between the "Employee Code" label and the
 * standalone "Employee" label. Short names sit inline on the same line;
 * Sage wraps longer ones onto their own lines with the "known as" name in
 * parentheses underneath. The capture is length-bounded so that a page
 * missing its "Employee" label yields null rather than half the payslip.
 */
function extractPlainPaperName(text: string): string | null {
  const m = text.match(PLAIN_NAME_SPAN);
  if (!m?.[1]) return null;
  const cleaned = m[1]
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

// ─── VIP (legacy) ────────────────────────────────────────────────────

const VIP_EMP_CODE = /Emp\s*Code\s+([A-Z0-9-]+)/i;
const VIP_EMP_NAME =
  /Emp\s*Name\s+([A-Za-z][A-Za-z .'-]+?)(?:\s{2,}|\n|\s+Emp\s|\s+Job\s|\s+Id\s|\s+Co\.|\s+Paypoint|$)/i;
const VIP_ID_NUMBER = /Id\s*Number\s+(\d{13})/i;
const VIP_PAYMENT_DT = /Payment\s*Dt\s+(\d{4}\/\d{2}\/\d{2})/i;
const VIP_TOTAL_EARNINGS = /Total\s+Earnings\s+([\d,]+\.\d{2})/i;

function extractVip(text: string): ExtractedFields {
  const empCode = matchOne(text, VIP_EMP_CODE);
  const empName = matchOne(text, VIP_EMP_NAME);
  const idNumber = matchOne(text, VIP_ID_NUMBER);
  const paymentDate = matchOne(text, VIP_PAYMENT_DT);
  const totalEarningsCents = parseRandToCents(matchOne(text, VIP_TOTAL_EARNINGS));

  // pdfjs returns text items in positional order, which interleaves the
  // earnings (left) and deductions (right) columns differently for each
  // page. The "Total Deductions" label and its value can land far apart,
  // and "NETT PAY" appears as a bare label without its value adjacent.
  //
  // Primary heuristic: nett pay is rendered with thousand-separators
  // (e.g. "21,400.88") while earnings/deductions sub-totals never use
  // thousand-separators in this VIP template. The unique comma-decimal
  // number on the page is the nett.
  //
  // Fallback: if the page contains more than one comma-decimal number
  // (e.g. an account number, year-to-date totals, a salary in the
  // hundreds of thousands), pick the largest one whose value is also
  // ≤ totalEarningsCents — nett pay is always less than earnings before
  // deductions (deductions can't be negative).
  let nettPayCents: number | null = null;
  const commaDecimalCents = [...text.matchAll(/(\d{1,3}(?:,\d{3})+\.\d{2})/g)]
    .map((m) => parseRandToCents(m[1]!))
    .filter((c): c is number => c !== null);

  if (commaDecimalCents.length === 1) {
    nettPayCents = commaDecimalCents[0]!;
  } else if (commaDecimalCents.length > 1 && totalEarningsCents !== null) {
    const candidates = commaDecimalCents
      .filter((c) => c <= totalEarningsCents && c > 0)
      .sort((a, b) => b - a);
    nettPayCents = candidates[0] ?? null;
  }

  const totalDeductionsCents =
    totalEarningsCents !== null && nettPayCents !== null
      ? totalEarningsCents - nettPayCents
      : null;

  return {
    empCode,
    empName,
    ...splitName(empName),
    idNumber,
    paymentDate,
    totalEarningsCents,
    totalDeductionsCents,
    nettPayCents,
  };
}

/** Same pattern, forced global, for counting occurrences. */
function globalise(re: RegExp): RegExp {
  return re.flags.includes('g') ? re : new RegExp(re.source, `${re.flags}g`);
}

/**
 * Every anchor the extractors actually depend on, paired with the *same*
 * regex the extractor uses. Reusing the extraction patterns is deliberate: a
 * hand-maintained list of label strings drifts away from the regexes it is
 * meant to describe, and a missed anchor is a blind spot precisely where the
 * check is supposed to see.
 *
 * Counting the full pattern (amount, tab and label — not the bare label) also
 * keeps the check quiet: prose that merely mentions "Nett pay" cannot be
 * mistaken for a second extractable value.
 */
interface AnchorSpec {
  readonly label: string;
  /** Global twin of the extractor's own pattern. */
  readonly pattern: RegExp;
  /** How many times the known templates match it. More than this = drift. */
  readonly expected: number;
}

const ANCHORS: Record<PayslipLayout, readonly AnchorSpec[]> = {
  plain_paper: [
    { label: 'Employee Code', pattern: globalise(PLAIN_EMP_CODE), expected: 1 },
    { label: 'Employee (name terminator)', pattern: globalise(PLAIN_NAME_END), expected: 1 },
    // The bare word, which the name span is bounded by. Two occurrences are
    // normal: one inside "Employee Code", one as the terminator. A third means
    // the template grew another "Employee …" field (e.g. "Employee Type")
    // between them — the name span would then swallow it, and neither of the
    // two anchors above would notice, because neither one changed count.
    { label: 'Employee (bare label)', pattern: /\bEmployee\b/gi, expected: 2 },
    { label: 'Identity Number', pattern: globalise(PLAIN_ID_NUMBER), expected: 1 },
    { label: 'Pay Date', pattern: globalise(PLAIN_PAY_DATE), expected: 1 },
    { label: 'Total earnings', pattern: globalise(PLAIN_TOTAL_EARNINGS), expected: 1 },
    { label: 'Nett pay', pattern: globalise(PLAIN_NETT_PAY), expected: 1 },
  ],
  vip: [
    { label: 'Emp Code', pattern: globalise(VIP_EMP_CODE), expected: 1 },
    { label: 'Emp Name', pattern: globalise(VIP_EMP_NAME), expected: 1 },
    { label: 'Id Number', pattern: globalise(VIP_ID_NUMBER), expected: 1 },
    { label: 'Payment Dt', pattern: globalise(VIP_PAYMENT_DT), expected: 1 },
    { label: 'Total Earnings', pattern: globalise(VIP_TOTAL_EARNINGS), expected: 1 },
  ],
};

/**
 * Anchors occurring more often than the known templates produce. Always empty
 * for the templates we support — zero across all 42 pages of the July 2026
 * Plain Paper export and all 25 of the March VIP export — so a non-empty
 * result means the payroll template changed shape and extraction may now be
 * reading something other than what a human would read off the page.
 *
 * This exists because the July 2026 breakage was exactly that: a Sage template
 * change the parser had no way to announce. Callers log it; nothing here
 * throws, since an extra match is a suspicion, not proof, and blocking payroll
 * on a heuristic is worse than flagging it.
 *
 * Uses `.match()`, never `.test()` — a shared /g regex carries `lastIndex`
 * between `.test()` calls and would report anomalies intermittently.
 */
export function findAnchorAnomalies(text: string, layout: PayslipLayout): string[] {
  return ANCHORS[layout]
    .filter(({ pattern, expected }) => (text.match(pattern) ?? []).length > expected)
    .map(({ label }) => label);
}

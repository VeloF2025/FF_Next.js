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

/**
 * The labels each layout anchors a field on. Extraction takes the *first*
 * match, so a label appearing twice means the value picked may not be the one
 * a human would read off the page.
 *
 * Sources are `.match()`-only — never `.test()` — because a shared /g regex
 * carries `lastIndex` between `.test()` calls and would report duplicates
 * intermittently.
 */
const ANCHOR_LABELS: Record<PayslipLayout, ReadonlyArray<readonly [string, RegExp]>> = {
  plain_paper: [
    ['Employee Code', /Employee\s+Code\b/gi],
    ['Identity Number', /Identity\s+Number\b/gi],
    ['Pay Date', /Pay\s+Date\b/gi],
    ['Total earnings', /Total\s+earnings\b/gi],
    ['Nett pay', /Nett\s+pay\b/gi],
  ],
  vip: [
    ['Emp Code', /Emp\s*Code\b/gi],
    ['Emp Name', /Emp\s*Name\b/gi],
    ['Id Number', /Id\s*Number\b/gi],
    ['Payment Dt', /Payment\s*Dt\b/gi],
    ['Total Earnings', /Total\s+Earnings\b/gi],
  ],
};

/**
 * Labels that occur more than once on a page. Always empty for the templates
 * we know about — Velocity's July 2026 export has zero across all 42 pages —
 * so a non-empty result means the payroll template changed shape and the
 * first-match-wins extraction may now be reading the wrong number.
 *
 * This exists because the July 2026 breakage came from exactly that: a Sage
 * template change that the parser had no way to announce. Callers log it;
 * nothing here throws, since a duplicate label is a suspicion, not proof.
 */
export function findDuplicateAnchors(text: string, layout: PayslipLayout): string[] {
  return ANCHOR_LABELS[layout]
    .filter(([, pattern]) => (text.match(pattern) ?? []).length > 1)
    .map(([label]) => label);
}

// ─── Plain Paper (current) ───────────────────────────────────────────

/**
 * A rand amount sitting immediately before its label, e.g. "25 000.00\tTotal
 * earnings". The thousands separator may be a plain space or a non-breaking /
 * narrow no-break space depending on the generator, so all three are allowed
 * inside the number — but deliberately NOT `\s`, which would let the capture
 * bridge a tab or newline and pick up a number from the neighbouring column.
 */
const AMOUNT_BEFORE_TOTAL_EARNINGS =
  /([\d,\u00a0\u202f ]+\.\d{2})[\u00a0\u202f ]*\t[ ]*Total\s+earnings\b/i;
const AMOUNT_BEFORE_NETT_PAY =
  /([\d,\u00a0\u202f ]+\.\d{2})[\u00a0\u202f ]*\t[ ]*Nett\s+pay\b/i;

function extractPlainPaper(text: string): ExtractedFields {
  // Anchor every value on the label that follows it. The tab is required —
  // it is what separates the value cell from the label cell, and without it
  // a bare number on the preceding line could be picked up instead.
  const empCode = matchOne(
    text,
    /(?:^|\t)[ ]*([A-Za-z0-9][A-Za-z0-9-]*)[ ]*\t[ ]*Employee\s+Code\b/im
  );
  const idNumber = matchOne(text, /(\d{13})[ ]*\t[ ]*Identity\s+Number\b/i);
  const paymentDate = matchOne(
    text,
    /(\d{4}\/\d{2}\/\d{2})[ ]*\t[ ]*Pay\s+Date\b/i
  );

  // "Total earnings" — never "Taxable earnings", which is the YTD figure and
  // is larger, so a loose anchor imports a wildly wrong gross.
  const totalEarningsCents = parseRandToCents(
    matchOne(text, AMOUNT_BEFORE_TOTAL_EARNINGS)
  );
  const nettPayCents = parseRandToCents(matchOne(text, AMOUNT_BEFORE_NETT_PAY));

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
  const m = text.match(/Employee\s+Code\b([\s\S]{0,120}?)\bEmployee\b/i);
  if (!m?.[1]) return null;
  const cleaned = m[1]
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

// ─── VIP (legacy) ────────────────────────────────────────────────────

function extractVip(text: string): ExtractedFields {
  const empCode = matchOne(text, /Emp\s*Code\s+([A-Z0-9-]+)/i);
  const empName = matchOne(
    text,
    /Emp\s*Name\s+([A-Za-z][A-Za-z .'-]+?)(?:\s{2,}|\n|\s+Emp\s|\s+Job\s|\s+Id\s|\s+Co\.|\s+Paypoint|$)/i
  );
  const idNumber = matchOne(text, /Id\s*Number\s+(\d{13})/i);
  const paymentDate = matchOne(text, /Payment\s*Dt\s+(\d{4}\/\d{2}\/\d{2})/i);
  const totalEarningsCents = parseRandToCents(
    matchOne(text, /Total\s+Earnings\s+([\d,]+\.\d{2})/i)
  );

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

// ─── Shared helpers ──────────────────────────────────────────────────

/**
 * First initial + last name, which is what `staffMatcher` falls back to when
 * neither payroll code nor ID number resolves. Handles VIP's "Mr A Smith"
 * and Plain Paper's "PIETER JOHANNES VAN NIEKERK" alike.
 */
function splitName(empName: string | null): {
  firstInitial: string | null;
  lastName: string | null;
} {
  if (!empName) return { firstInitial: null, lastName: null };
  const tokens = empName
    .replace(/^(Mr|Mrs|Ms|Miss|Dr)\.?\s+/i, '')
    .trim()
    .split(/\s+/);

  const firstToken = tokens[0];
  const firstInitial = firstToken
    ? firstToken.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase() || null
    : null;
  const lastName = tokens.length >= 2 ? tokens[tokens.length - 1]!.toLowerCase() : null;
  return { firstInitial, lastName };
}

function matchOne(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m && m[1] ? m[1].trim() : null;
}

/**
 * "21,400.88" (VIP) and "25 000.00" (Plain Paper) both become cents.
 * Non-breaking and narrow no-break spaces are stripped too — some PDF
 * generators use them as the thousands separator.
 */
function parseRandToCents(raw: string | null): number | null {
  if (raw === null) return null;
  const cleaned = raw.replace(/[\s,]/g, '');
  if (cleaned === '') return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
}

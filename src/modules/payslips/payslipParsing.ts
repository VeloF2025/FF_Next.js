/**
 * Parsing helpers shared by both payslip layouts.
 *
 * Kept apart from `payslipLayouts.ts` so that file stays within the 300-line
 * limit; these are pure string helpers with no knowledge of either template.
 */

/**
 * First initial + last name, which is what `staffMatcher` falls back to when
 * neither payroll code nor ID number resolves. Handles VIP's "Mr A Smith"
 * and Plain Paper's "PIETER JOHANNES VAN NIEKERK" alike.
 */
export function splitName(empName: string | null): {
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

export function matchOne(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m && m[1] ? m[1].trim() : null;
}

/**
 * "21,400.88" (VIP) and "25 000.00" (Plain Paper) both become cents.
 * Non-breaking and narrow no-break spaces are stripped too — some PDF
 * generators use them as the thousands separator.
 */
export function parseRandToCents(raw: string | null): number | null {
  if (raw === null) return null;
  const cleaned = raw.replace(/[\s,]/g, '');
  if (cleaned === '') return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
}

/**
 * CSV-export helpers for the receipts module. Pure functions, kept
 * out of the API route so they can be unit-tested without a request
 * mock.
 */

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Format an integer-cents string (or null) as Rand with two decimals,
 * with no currency symbol or thousand separators (Excel-friendly).
 * Empty string for null / undefined / non-finite inputs.
 */
export function centsToRand(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return (n / 100).toFixed(2);
}

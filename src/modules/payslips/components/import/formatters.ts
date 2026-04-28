/**
 * Pure formatters shared across the payslip import UI.
 * Lives in its own module so legacy + combined views and the hook can
 * import without crossing concerns.
 */

export function formatRand(cents: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

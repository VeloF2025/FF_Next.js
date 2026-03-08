/**
 * Format a number as South African Rand currency.
 */
export function formatCurrency(amount: number | string | null | undefined): string {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(num);
}

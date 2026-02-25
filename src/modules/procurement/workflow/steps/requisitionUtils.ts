/**
 * Shared utility functions for the procurement workflow requisition steps.
 * Kept in a separate file to satisfy react-refresh/only-export-components.
 */

/** Compute a line total from quantity and unit price, returning 0 when either is blank. */
export function calcLineTotal(qty: number | '', price: number | ''): number {
  if (qty === '' || price === '' || (price as number) <= 0) return 0;
  return (qty as number) * (price as number);
}

/** Format a ZAR currency value using South African locale conventions. */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
  }).format(value);
}

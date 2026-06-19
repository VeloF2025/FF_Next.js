/**
 * Display formatting helpers for Pulse · Search results.
 *
 * Pure functions — no React imports. Extracted from ResultRow.tsx to satisfy
 * the `react-refresh/only-export-components` rule (a .tsx file must not
 * export non-component functions alongside components).
 */

export function fmtHrs(n: number): string {
  return n.toFixed(2);
}

export function fmtRand(cents: number): string {
  return (cents / 100).toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' });
}

/** Format an ISO timestamp as HH:MM in SAST. */
export function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Johannesburg',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    /* invalid ISO string — fall back to the raw HH:MM substring */
    return iso.slice(11, 16);
  }
}

export function fmtWageCents(cents: number | null): string {
  return cents === null ? '—' : fmtRand(cents);
}

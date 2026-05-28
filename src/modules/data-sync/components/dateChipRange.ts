/**
 * Helpers for translating a DateChipFilter selection into the YYYY-MM-DD pair
 * that most data-sync API routes expect on `dateFrom` / `dateTo` query params.
 *
 * `types.ts:getDateRange` returns ISO timestamps; this returns plain dates so
 * callers can pass them directly into Postgres `::date` casts.
 */

import type { DateFilter } from '../types';

export interface YmdRange {
  dateFrom?: string;
  dateTo?: string;
}

function ymd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getDateChipRangeYmd(
  filter: DateFilter,
  customDateFrom: string,
  customDateTo: string,
): YmdRange {
  if (filter === 'all') return {};
  if (filter === 'custom') {
    return {
      dateFrom: customDateFrom || undefined,
      dateTo: customDateTo || undefined,
    };
  }
  const now = new Date();
  if (filter === 'today') {
    return { dateFrom: ymd(now) };
  }
  if (filter === 'yesterday') {
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return { dateFrom: ymd(y), dateTo: ymd(y) };
  }
  if (filter === '7d') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    return { dateFrom: ymd(start) };
  }
  if (filter === '30d') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    return { dateFrom: ymd(start) };
  }
  return {};
}

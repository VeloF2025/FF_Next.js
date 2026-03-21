/**
 * useExpensePivotData — React Query hook for the Expense Pivot report.
 * Fetches Category T2 × month pivot data from SharePoint via the API.
 */

import { useQuery } from '@tanstack/react-query';

/** Filter type for the pivot */
export type PivotType = 'Expense' | 'Income' | 'All';

/** A single pivot data row — one category across all months */
export interface PivotRow {
  /** Category T2 label from the Data sheet */
  category: string;
  /** Amount Excl. VAT keyed by "YYYY-MMM" month key */
  monthly: Record<string, number>;
  /** Subtotals keyed by year string e.g. "2025" */
  yearTotals: Record<string, number>;
  /** Sum across all months */
  grandTotal: number;
}

/** Full pivot dataset returned by the API */
export interface PivotData {
  /** Sorted month keys e.g. ["2025-Apr", "2025-May", ...] */
  months: string[];
  /** Months grouped by year e.g. { "2025": ["2025-Apr",...] } */
  yearGroups: Record<string, string[]>;
  /** Data rows sorted by grandTotal descending */
  rows: PivotRow[];
  /** Column grand totals */
  grandTotals: {
    monthly: Record<string, number>;
    yearTotals: Record<string, number>;
    grandTotal: number;
  };
}

/** API response envelope */
export interface PivotResponse {
  success: boolean;
  data: PivotData;
}

/** Error response body shape */
interface ApiErrorBody {
  error?: { message?: string };
}

async function fetchExpensePivot(type: PivotType): Promise<PivotResponse> {
  const res = await fetch(`/api/analytics/reports/expense-pivot?type=${type}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message ?? 'Failed to load expense pivot data');
  }
  return res.json() as Promise<PivotResponse>;
}

// 🟢 WORKING: React Query hook with 5-minute cache for expense pivot data
export function useExpensePivotData(type: PivotType = 'Expense') {
  return useQuery<PivotResponse, Error>({
    queryKey: ['analytics', 'expense-pivot', type],
    queryFn: () => fetchExpensePivot(type),
    staleTime: 5 * 60 * 1000,
  });
}

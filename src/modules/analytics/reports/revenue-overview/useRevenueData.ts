/**
 * useRevenueData — React Query hook for the Revenue Overview (cashflow) report.
 * Fetches monthly Cash In / Cash Out / Net data from SharePoint via the API.
 */

import { useQuery } from '@tanstack/react-query';

/** A single monthly cashflow data point */
export interface CashflowDataPoint {
  /** Month label, e.g. "Jan 2026" */
  label: string;
  /** Cash inflows for the month */
  cashIn: number;
  /** Cash outflows for the month */
  cashOut: number;
  /** Net cash movement (Cash In − Cash Out) */
  net: number;
}

/** Response shape returned by /api/analytics/reports/revenue-overview */
export interface CashflowResponse {
  success: boolean;
  data: CashflowDataPoint[];
  meta: {
    /** Optional informational note */
    note?: string;
    /** ISO timestamp of when this data was generated */
    generatedAt: string;
    /** Number of months returned */
    monthCount: number;
    /** Currency code, always "ZAR" */
    currency: string;
  };
}

/** Error response shape from the API */
interface ApiErrorBody {
  error?: {
    message?: string;
  };
}

async function fetchRevenueData(): Promise<CashflowResponse> {
  const res = await fetch('/api/analytics/reports/revenue-overview');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message ?? 'Failed to load revenue data');
  }
  return res.json() as Promise<CashflowResponse>;
}

// 🟢 WORKING: React Query hook with 5-minute cache
export function useRevenueData() {
  return useQuery<CashflowResponse, Error>({
    queryKey: ['analytics', 'revenue-overview'],
    queryFn: fetchRevenueData,
    staleTime: 5 * 60 * 1000,
  });
}

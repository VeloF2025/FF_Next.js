/**
 * useRevenueData — React Query hook for the Revenue Overview (cashflow) report.
 * Fetches Cash In / Cash Out / Cash Movement / Closing Balance data from SharePoint via the API.
 */

import { useQuery } from '@tanstack/react-query';

/** @deprecated Use CashflowRow instead */
export interface CashflowDataPoint {
  label: string;
  cashIn: number;
  cashOut: number;
  net: number;
}

export interface CashflowRow {
  label: string;
  fy26: number;
  fy27: number;
  fy28: number;
  monthly: Record<string, number>;
  isBold?: boolean;
}

export interface CashflowData {
  rows: CashflowRow[];
  months: string[];
  meta: { generatedAt: string; sources: string[] };
}

/** Response shape returned by /api/analytics/reports/revenue-overview */
export interface CashflowResponse {
  success: boolean;
  data: CashflowData;
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

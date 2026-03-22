// 🟢 WORKING: React Query hook for COS Breakdown report
import { useQuery } from '@tanstack/react-query';
import type { IncomeStatementData } from '../income-statement/useIncomeStatementData';

interface ApiResponse {
  success: boolean;
  data: IncomeStatementData;
  meta: { generatedAt: string; sources: string[] };
  error?: { code: string; message: string };
}

async function fetchCosBreakdown(): Promise<ApiResponse> {
  const res = await fetch('/api/analytics/reports/cos-breakdown');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiResponse;
    throw new Error(body.error?.message ?? 'Failed to load COS breakdown');
  }
  return res.json() as Promise<ApiResponse>;
}

export function useCosBreakdownData() {
  return useQuery<ApiResponse, Error>({
    queryKey: ['analytics', 'cos-breakdown'],
    queryFn: fetchCosBreakdown,
    staleTime: 5 * 60 * 1000,
  });
}

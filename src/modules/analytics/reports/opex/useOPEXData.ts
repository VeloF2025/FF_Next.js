// 🟢 WORKING: React Query hook for Operational Expenses (OPEX tab)
import { useQuery } from '@tanstack/react-query';
import type { OPEXData, OPEXRow } from '@/app/api/analytics/reports/opex/route';

export type { OPEXData, OPEXRow };

interface ApiResponse {
  success: boolean;
  data: OPEXData;
  meta: { generatedAt: string; sources: string[] };
  error?: { code: string; message: string };
}

async function fetchOPEX(): Promise<ApiResponse> {
  const res = await fetch('/api/analytics/reports/opex');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiResponse;
    throw new Error(body.error?.message ?? 'Failed to load OPEX data');
  }
  return res.json() as Promise<ApiResponse>;
}

export function useOPEXData() {
  return useQuery<ApiResponse, Error>({
    queryKey: ['analytics', 'opex'],
    queryFn: fetchOPEX,
    staleTime: 5 * 60 * 1000,
  });
}

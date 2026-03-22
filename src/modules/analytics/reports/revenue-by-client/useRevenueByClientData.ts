// 🟢 WORKING: React Query hook for Revenue by Client report
import { useQuery } from '@tanstack/react-query';

export interface RevenueByClientItem {
  client: string;
  revenue: number;
}

interface ApiResponse {
  success: boolean;
  data: RevenueByClientItem[];
  meta: { generatedAt: string; sources: string[] };
  error?: { code: string; message: string };
}

async function fetchRevenueByClient(): Promise<ApiResponse> {
  const res = await fetch('/api/analytics/reports/revenue-by-client');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiResponse;
    throw new Error(body.error?.message ?? 'Failed to load revenue by client');
  }
  return res.json() as Promise<ApiResponse>;
}

export function useRevenueByClientData() {
  return useQuery<ApiResponse, Error>({
    queryKey: ['analytics', 'revenue-by-client'],
    queryFn: fetchRevenueByClient,
    staleTime: 5 * 60 * 1000,
  });
}

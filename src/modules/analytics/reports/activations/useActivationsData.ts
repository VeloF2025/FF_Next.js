// 🟢 WORKING: React Query hook for Activations report
import { useQuery } from '@tanstack/react-query';
import type { ActivationsData } from '@/app/api/analytics/reports/activations/route';

export type { ActivationsData, ActivationYear, ActivationMonth, ActivationWeek } from '@/app/api/analytics/reports/activations/route';

interface ApiResponse {
  success: boolean;
  data: ActivationsData;
  error?: { code: string; message: string };
}

async function fetchActivations(): Promise<ApiResponse> {
  const res = await fetch('/api/analytics/reports/activations');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiResponse;
    throw new Error(body.error?.message ?? 'Failed to load activations data');
  }
  return res.json() as Promise<ApiResponse>;
}

export function useActivationsData() {
  return useQuery<ApiResponse, Error>({
    queryKey: ['analytics', 'activations'],
    queryFn: fetchActivations,
    staleTime: 5 * 60 * 1000,
  });
}

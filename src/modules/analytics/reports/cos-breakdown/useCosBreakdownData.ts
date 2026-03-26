// 🟢 WORKING: React Query hook for COS Breakdown report (Data tab source)
'use client';

import { useQuery } from '@tanstack/react-query';
import type { CosBreakdownData } from '@/app/api/analytics/reports/cos-breakdown/route';

export type { CosBreakdownData, CosBreakdownRow } from '@/app/api/analytics/reports/cos-breakdown/route';

async function fetchCosBreakdown(): Promise<CosBreakdownData> {
  const res = await fetch('/api/analytics/reports/cos-breakdown');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message ?? 'Failed to load COS breakdown');
  }
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message ?? 'Unknown error');
  return json.data as CosBreakdownData;
}

export function useCosBreakdownData() {
  return useQuery<CosBreakdownData, Error>({
    queryKey: ['analytics', 'cos-breakdown'],
    queryFn: fetchCosBreakdown,
    staleTime: 5 * 60 * 1000,
  });
}

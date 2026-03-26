// 🟢 WORKING: React Query hook for COS Breakdown report
'use client';

import { useQuery } from '@tanstack/react-query';
import type { CosBreakdownData } from '@/app/api/analytics/reports/cos-breakdown/route';

export type { CosBreakdownData, CosBreakdownCategory, CosBreakdownRow } from '@/app/api/analytics/reports/cos-breakdown/route';

async function fetchCosBreakdown(bu: string, proj: string): Promise<CosBreakdownData> {
  const params = new URLSearchParams();
  if (bu) params.set('businessUnit', bu);
  if (proj) params.set('project', proj);
  const url = `/api/analytics/reports/cos-breakdown${params.size ? '?' + params.toString() : ''}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message ?? 'Failed to load COS breakdown');
  }
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message ?? 'Unknown error');
  return json.data as CosBreakdownData;
}

export function useCosBreakdownData(businessUnit = '', project = '') {
  return useQuery<CosBreakdownData, Error>({
    queryKey: ['analytics', 'cos-breakdown', businessUnit, project],
    queryFn: () => fetchCosBreakdown(businessUnit, project),
    staleTime: 5 * 60 * 1000,
  });
}

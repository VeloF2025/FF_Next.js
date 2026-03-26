/**
 * useProjectRevenueData — React Query hook for Project Profitability (Forecast vs Actual).
 * 🟢 WORKING
 */
'use client';

import { useQuery } from '@tanstack/react-query';
import type { ProjectProfitabilityData } from '@/app/api/analytics/reports/project-revenue/route';

export type { ProjectProfitabilityData, ProjectProfitabilityRow } from '@/app/api/analytics/reports/project-revenue/route';

async function fetchProjectProfitability(): Promise<ProjectProfitabilityData> {
  const res = await fetch('/api/analytics/reports/project-revenue');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message ?? 'Failed to load project profitability');
  }
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message ?? 'Unknown error');
  return json.data as ProjectProfitabilityData;
}

export function useProjectRevenueData() {
  return useQuery<ProjectProfitabilityData, Error>({
    queryKey: ['analytics', 'project-profitability'],
    queryFn: fetchProjectProfitability,
    staleTime: 5 * 60 * 1000,
  });
}

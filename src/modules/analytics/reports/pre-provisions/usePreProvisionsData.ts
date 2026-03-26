/**
 * usePreProvisionsData — React Query hook for Pre-Provisions report
 * 🟢 WORKING
 */
'use client';

import { useQuery } from '@tanstack/react-query';
import type { PreProvisionsData } from '@/app/api/analytics/reports/pre-provisions/route';

export type { PreProvisionsData, PreProvisionYear, PreProvisionMonth, PreProvisionProject } from '@/app/api/analytics/reports/pre-provisions/route';

export function usePreProvisionsData() {
  return useQuery<PreProvisionsData>({
    queryKey: ['preProvisions'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/reports/pre-provisions');
      if (!res.ok) throw new Error('Failed to fetch pre-provisions');
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? 'Unknown error');
      return json.data as PreProvisionsData;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Build Milestones data hook
 * 🟢 WORKING
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import type { BuildMilestonesData } from '@/app/api/analytics/reports/build-milestones/route';

export function useBuildMilestonesData() {
  return useQuery<BuildMilestonesData>({
    queryKey: ['buildMilestones'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/reports/build-milestones', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
        },
      });
      if (!res.ok) throw new Error('Failed to fetch build milestones');
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      return json.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { planningKeys } from './usePlanningItems';
import type { PlanningItem, PlanningItemWithRelations, UpdatePlanningItemPayload } from '../types/planning';

async function fetchPlanningItem(id: string): Promise<PlanningItemWithRelations> {
  const res = await fetch(`/api/planning/items/${id}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'Failed to load planning item');
  return json.data;
}

export function usePlanningItem(id: string) {
  return useQuery({ queryKey: planningKeys.detail(id), queryFn: () => fetchPlanningItem(id), enabled: !!id });
}

export function useUpdatePlanningItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: UpdatePlanningItemPayload }): Promise<PlanningItem> => {
      const res = await fetch(`/api/planning/items/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || 'Failed to update planning item');
      return json.data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: planningKeys.detail(data.id) });
      qc.invalidateQueries({ queryKey: planningKeys.lists() });
    },
  });
}

export function usePlanningActivities(id: string) {
  return useQuery({
    queryKey: planningKeys.activities(id),
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/planning/items/${id}`);
      // Note: activities are returned by a dedicated call in a later iteration; for v1 read from detail page fetch
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || 'Failed');
      return json.data;
    },
  });
}

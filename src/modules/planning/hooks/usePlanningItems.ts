'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePlanningItemPayload, PlanningFilters, PlanningItem, PlanningListResponse,
} from '../types/planning';

export const planningKeys = {
  all: ['planning'] as const,
  lists: () => [...planningKeys.all, 'list'] as const,
  list: (filters?: PlanningFilters) => [...planningKeys.lists(), filters] as const,
  details: () => [...planningKeys.all, 'detail'] as const,
  detail: (id: string) => [...planningKeys.details(), id] as const,
  activities: (id: string) => [...planningKeys.all, 'activities', id] as const,
};

function toQueryString(filters?: PlanningFilters): string {
  if (!filters) return '';
  const p = new URLSearchParams();
  if (filters.project_id) p.set('project_id', filters.project_id);
  if (filters.pipeline_project_id) p.set('pipeline_project_id', filters.pipeline_project_id);
  if (filters.stage) p.set('stage', filters.stage);
  filters.exclude_stage?.forEach(s => p.append('exclude_stage', s));
  if (filters.assigned_to) p.set('assigned_to', filters.assigned_to);
  if (filters.search) p.set('search', filters.search);
  if (filters.created_after) p.set('created_after', filters.created_after.toISOString());
  if (filters.created_before) p.set('created_before', filters.created_before.toISOString());
  if (filters.page) p.set('page', String(filters.page));
  if (filters.pageSize) p.set('pageSize', String(filters.pageSize));
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function fetchPlanningItems(filters?: PlanningFilters): Promise<PlanningListResponse> {
  const res = await fetch(`/api/planning/items${toQueryString(filters)}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'Failed to load planning items');
  return { data: json.data, pagination: json.pagination };
}

export function usePlanningItems(filters?: PlanningFilters, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: planningKeys.list(filters),
    queryFn: () => fetchPlanningItems(filters),
    enabled: options?.enabled ?? true,
  });
}

export function useCreatePlanningItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreatePlanningItemPayload): Promise<PlanningItem> => {
      const res = await fetch('/api/planning/items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || 'Failed to create planning item');
      return json.data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: planningKeys.lists() }); },
  });
}

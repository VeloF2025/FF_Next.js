'use client';

import { useQuery } from '@tanstack/react-query';
import type { TicketFilters } from '../types/ticket';

export interface TicketSummaryData {
  counts: Record<string, number>;
  total: number;
}

async function fetchSummary(filters?: TicketFilters): Promise<TicketSummaryData> {
  const params = new URLSearchParams();

  if (filters) {
    if (filters.status) params.append('status', String(filters.status));
    if (filters.ticket_type) params.append('ticket_type', String(filters.ticket_type));
    if (filters.priority) params.append('priority', String(filters.priority));
    if (filters.source) params.append('source', String(filters.source));
    if (filters.assigned_to) params.append('assigned_to', filters.assigned_to);
    if (filters.assigned_team_id) params.append('assigned_team_id', filters.assigned_team_id);
    if (filters.project_id) params.append('project_id', filters.project_id);
    if (filters.dr_number) params.append('dr_number', filters.dr_number);
    if (filters.qa_ready !== undefined) params.append('qa_ready', String(filters.qa_ready));
    if (filters.sla_breached !== undefined) params.append('sla_breached', String(filters.sla_breached));
    if (filters.search) params.append('search', filters.search);
    if (filters.created_after) params.append('created_after', new Date(filters.created_after).toISOString());
    if (filters.created_before) params.append('created_before', new Date(filters.created_before).toISOString());
  }

  const url = `/api/noc/tickets/summary?${params.toString()}`;
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error('Failed to fetch ticket summary');
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to fetch ticket summary');
  }

  return result.data;
}

export function useTicketSummary(filters?: TicketFilters) {
  const query_ = useQuery({
    queryKey: ['tickets', 'summary', filters],
    queryFn: () => fetchSummary(filters),
    staleTime: 30000,
    refetchInterval: 60000, // Lightweight — fine to poll
  });

  return {
    counts: query_.data?.counts ?? {},
    total: query_.data?.total ?? 0,
    isLoading: query_.isLoading,
    isError: query_.isError,
  };
}

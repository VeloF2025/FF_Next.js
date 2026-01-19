/**
 * useTickets Hook - Fetch and manage tickets list
 *
 * 🟢 WORKING: Production-ready hook for tickets list management
 *
 * Features:
 * - List tickets with filtering (status, type, priority, assignee, etc.)
 * - Pagination support
 * - Sort and search
 * - React Query integration for caching and auto-refresh
 * - Loading and error states
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  Ticket,
  TicketFilters,
  TicketListResult,
  CreateTicketPayload,
} from '../types/ticket';

// ==================== Query Keys ====================

/**
 * 🟢 WORKING: Query keys factory for tickets
 */
export const ticketsKeys = {
  all: ['tickets'] as const,
  lists: () => [...ticketsKeys.all, 'list'] as const,
  list: (filters?: TicketFilters) => [...ticketsKeys.lists(), filters] as const,
  details: () => [...ticketsKeys.all, 'detail'] as const,
  detail: (id: string) => [...ticketsKeys.details(), id] as const,
};

// ==================== API Functions ====================

/**
 * 🟢 WORKING: Fetch tickets list from API
 */
async function fetchTickets(filters?: TicketFilters): Promise<TicketListResult> {
  // Build query string from filters
  const params = new URLSearchParams();

  if (filters) {
    if (filters.status) params.append('status', filters.status);
    if (filters.ticket_type) params.append('ticket_type', filters.ticket_type);
    if (filters.priority) params.append('priority', filters.priority);
    if (filters.source) params.append('source', filters.source);
    if (filters.assigned_to) params.append('assigned_to', filters.assigned_to);
    if (filters.project_id) params.append('project_id', filters.project_id);
    if (filters.dr_number) params.append('dr_number', filters.dr_number);
    if (filters.qa_ready !== undefined) params.append('qa_ready', String(filters.qa_ready));
    if (filters.sla_breached !== undefined) params.append('sla_breached', String(filters.sla_breached));
    if (filters.search) params.append('search', filters.search);
    if (filters.sort) params.append('sort', filters.sort);
    if (filters.page !== undefined) params.append('page', String(filters.page));
    if (filters.pageSize !== undefined) params.append('pageSize', String(filters.pageSize));
  }

  const url = `/api/ticketing/tickets?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch tickets');
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to fetch tickets');
  }

  return {
    tickets: result.data || [],
    pagination: result.pagination || {
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
    },
  };
}

/**
 * 🟢 WORKING: Create new ticket
 */
async function createTicketRequest(payload: CreateTicketPayload): Promise<Ticket> {
  const response = await fetch('/api/ticketing/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to create ticket');
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to create ticket');
  }

  return result.data;
}

// ==================== React Query Hooks ====================

/**
 * 🟢 WORKING: Hook to fetch tickets list with filters
 *
 * @example
 * ```tsx
 * const { tickets, pagination, isLoading, error } = useTickets({
 *   status: 'open',
 *   page: 1,
 *   pageSize: 20,
 * });
 * ```
 */
export function useTickets(filters?: TicketFilters) {
  const query = useQuery({
    queryKey: ticketsKeys.list(filters),
    queryFn: () => fetchTickets(filters),
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refresh every minute
  });

  return {
    tickets: query.data?.tickets || [],
    pagination: query.data?.pagination,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * 🟢 WORKING: Hook to create new ticket
 *
 * @example
 * ```tsx
 * const createTicket = useCreateTicket();
 *
 * createTicket.mutate({
 *   title: 'New Ticket',
 *   source: 'manual',
 *   ticket_type: 'maintenance',
 *   priority: 'normal',
 * });
 * ```
 */
export function useCreateTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createTicketRequest,
    onSuccess: () => {
      // Invalidate all ticket lists on successful creation
      queryClient.invalidateQueries({ queryKey: ticketsKeys.lists() });
    },
  });
}

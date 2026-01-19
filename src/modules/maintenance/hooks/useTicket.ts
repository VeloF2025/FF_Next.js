/**
 * useTicket Hook - Fetch and manage single ticket
 *
 * 🟢 WORKING: Production-ready hook for single ticket management
 *
 * Features:
 * - Fetch single ticket by ID
 * - Update ticket details
 * - Delete ticket (soft delete)
 * - React Query integration for caching
 * - Loading and error states
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Ticket, EnrichedTicket, UpdateTicketPayload } from '../types/ticket';
import { ticketsKeys } from './useTickets';

// ==================== API Functions ====================

/**
 * 🟢 WORKING: Fetch single ticket by ID with optional enrichment
 */
async function fetchTicketById(id: string, enrich = true): Promise<EnrichedTicket> {
  const url = enrich
    ? `/api/ticketing/tickets/${id}?enrich=true`
    : `/api/ticketing/tickets/${id}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch ticket');
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to fetch ticket');
  }

  return result.data;
}

/**
 * 🟢 WORKING: Update ticket
 */
async function updateTicketRequest(id: string, payload: UpdateTicketPayload): Promise<Ticket> {
  const response = await fetch(`/api/ticketing/tickets/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to update ticket');
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to update ticket');
  }

  return result.data;
}

/**
 * 🟢 WORKING: Delete ticket (soft delete)
 */
async function deleteTicketRequest(id: string): Promise<void> {
  const response = await fetch(`/api/ticketing/tickets/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to delete ticket');
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to delete ticket');
  }
}

// ==================== React Query Hooks ====================

/**
 * 🟢 WORKING: Hook to fetch single ticket by ID
 *
 * @example
 * ```tsx
 * const { ticket, isLoading, error } = useTicket(ticketId);
 * ```
 */
export function useTicket(id: string) {
  const query = useQuery({
    queryKey: ticketsKeys.detail(id),
    queryFn: () => fetchTicketById(id),
    staleTime: 30000, // 30 seconds
    enabled: !!id, // Only fetch if ID is provided
  });

  return {
    ticket: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * 🟢 WORKING: Hook to update ticket
 *
 * @example
 * ```tsx
 * const updateTicket = useUpdateTicket();
 *
 * updateTicket.mutate({
 *   id: ticketId,
 *   payload: { status: 'assigned', assigned_to: userId },
 * });
 * ```
 */
export function useUpdateTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateTicketPayload }) =>
      updateTicketRequest(id, payload),
    onSuccess: (data) => {
      // Update cache for this specific ticket
      queryClient.setQueryData(ticketsKeys.detail(data.id), data);

      // Invalidate all ticket lists
      queryClient.invalidateQueries({ queryKey: ticketsKeys.lists() });
    },
  });
}

/**
 * 🟢 WORKING: Hook to delete ticket
 *
 * @example
 * ```tsx
 * const deleteTicket = useDeleteTicket();
 *
 * deleteTicket.mutate(ticketId);
 * ```
 */
export function useDeleteTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteTicketRequest,
    onSuccess: (_, id) => {
      // Remove ticket from cache
      queryClient.removeQueries({ queryKey: ticketsKeys.detail(id) });

      // Invalidate all ticket lists
      queryClient.invalidateQueries({ queryKey: ticketsKeys.lists() });
    },
  });
}

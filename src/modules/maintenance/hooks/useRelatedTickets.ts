/**
 * useRelatedTickets Hook - Fetch related tickets by DR number
 *
 * Shows other tickets with the same DR number (customer/location).
 * Excludes the current ticket from results.
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import type { Ticket } from '../types/ticket';

interface RelatedTicket {
  id: string;
  ticket_uid: string;
  title: string;
  status: string;
  created_at: string;
  external_id?: string;
}

interface UseRelatedTicketsResult {
  relatedTickets: RelatedTicket[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetch related tickets from API
 */
async function fetchRelatedTickets(
  ticketId: string,
  drNumber: string
): Promise<RelatedTicket[]> {
  const params = new URLSearchParams({
    dr_number: drNumber,
    pageSize: '10', // Limit to 10 related tickets
  });

  const response = await fetch(`/api/ticketing/tickets?${params.toString()}`);

  if (!response.ok) {
    throw new Error('Failed to fetch related tickets');
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to fetch related tickets');
  }

  // Filter out current ticket and map to RelatedTicket shape
  const tickets: Ticket[] = result.data || [];
  return tickets
    .filter((t) => t.id !== ticketId)
    .map((t) => ({
      id: t.id,
      ticket_uid: t.ticket_uid,
      title: t.title,
      status: t.status,
      created_at: t.created_at,
      external_id: t.external_id,
    }));
}

/**
 * Hook to fetch related tickets by DR number
 *
 * @param ticketId - Current ticket ID (to exclude from results)
 * @param drNumber - DR number to search for related tickets
 *
 * @example
 * ```tsx
 * const { relatedTickets, isLoading } = useRelatedTickets(ticketId, ticket.dr_number);
 * ```
 */
export function useRelatedTickets(
  ticketId: string,
  drNumber: string | null | undefined
): UseRelatedTicketsResult {
  const query = useQuery({
    queryKey: ['tickets', 'related', ticketId, drNumber],
    queryFn: () => fetchRelatedTickets(ticketId, drNumber!),
    enabled: !!drNumber && !!ticketId, // Only fetch if DR number exists
    staleTime: 60000, // 1 minute
  });

  return {
    relatedTickets: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

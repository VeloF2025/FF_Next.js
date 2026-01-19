/**
 * useTicketActivities Hook - Fetch ticket activities
 *
 * Features:
 * - Fetch activities from QContact and local database
 * - Filter by type (notes, updates, etc.)
 * - Loading and error states
 * - Auto-refresh support
 */

'use client';

import { useQuery } from '@tanstack/react-query';

// Activity type from API
export interface TicketActivity {
  id: string;
  type: 'note' | 'update' | 'status_change' | 'assignment' | 'message' | 'system';
  description: string | null;
  field_changes: Array<{
    field: string;
    old_value?: string;
    new_value: string;
  }> | null;
  created_by: {
    name: string;
    email?: string;
  } | null;
  created_at: string;
  source: 'qcontact' | 'fibreflow';
  is_private: boolean;
  is_pinned: boolean;
}

export interface ActivitiesSummary {
  notes: number;
  updates: number;
  messages: number;
  system: number;
  total: number;
}

export interface ActivitiesResponse {
  activities: TicketActivity[];
  summary: ActivitiesSummary;
  has_qcontact: boolean;
}

interface FetchOptions {
  source?: 'all' | 'qcontact' | 'local';
  type?: TicketActivity['type'];
}

/**
 * Fetch activities from API
 */
async function fetchActivities(
  ticketId: string,
  options: FetchOptions = {}
): Promise<ActivitiesResponse> {
  const params = new URLSearchParams();
  if (options.source) params.set('source', options.source);
  if (options.type) params.set('type', options.type);

  const url = `/api/ticketing/tickets/${ticketId}/activities${params.toString() ? '?' + params.toString() : ''}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch activities');
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to fetch activities');
  }

  return result.data;
}

/**
 * Query key factory for activities
 */
export const activitiesKeys = {
  all: ['activities'] as const,
  byTicket: (ticketId: string) => ['activities', 'ticket', ticketId] as const,
  filtered: (ticketId: string, options: FetchOptions) =>
    ['activities', 'ticket', ticketId, options] as const,
};

/**
 * Hook to fetch ticket activities
 *
 * @example
 * ```tsx
 * const { activities, summary, isLoading } = useTicketActivities(ticketId);
 * ```
 */
export function useTicketActivities(
  ticketId: string,
  options: FetchOptions = {}
) {
  const query = useQuery({
    queryKey: activitiesKeys.filtered(ticketId, options),
    queryFn: () => fetchActivities(ticketId, options),
    staleTime: 30000, // 30 seconds
    enabled: !!ticketId,
    refetchInterval: 60000, // Refresh every minute
  });

  return {
    activities: query.data?.activities ?? [],
    summary: query.data?.summary ?? { notes: 0, updates: 0, messages: 0, system: 0, total: 0 },
    hasQContact: query.data?.has_qcontact ?? false,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Hook to fetch only notes
 */
export function useTicketNotes(ticketId: string) {
  return useTicketActivities(ticketId, { type: 'note' });
}

/**
 * Hook to fetch only updates (field changes & status changes)
 */
export function useTicketUpdates(ticketId: string) {
  const query = useQuery({
    queryKey: activitiesKeys.filtered(ticketId, { type: 'update' }),
    queryFn: async () => {
      const [updates, statusChanges] = await Promise.all([
        fetchActivities(ticketId, { type: 'update' }),
        fetchActivities(ticketId, { type: 'status_change' }),
      ]);

      // Combine and sort
      const combined = [...updates.activities, ...statusChanges.activities];
      combined.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      return {
        activities: combined,
        summary: {
          notes: 0,
          updates: combined.length,
          messages: 0,
          system: 0,
          total: combined.length,
        },
        has_qcontact: updates.has_qcontact,
      };
    },
    staleTime: 30000,
    enabled: !!ticketId,
  });

  return {
    activities: query.data?.activities ?? [],
    summary: query.data?.summary ?? { notes: 0, updates: 0, messages: 0, system: 0, total: 0 },
    hasQContact: query.data?.has_qcontact ?? false,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

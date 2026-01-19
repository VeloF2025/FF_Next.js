/**
 * useAssignment Hook - Ticket assignment operations
 *
 * Provides hooks for fetching users/teams for assignment and
 * assigning tickets to users and teams.
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserDropdownOption, TeamDropdownOption } from '../types/team';
import { ticketsKeys } from './useTickets';

// ==================== Query Keys ====================

export const assignmentKeys = {
  users: ['assignment', 'users'] as const,
  teams: ['assignment', 'teams'] as const,
};

// ==================== API Functions ====================

async function fetchUsersForAssignment(): Promise<UserDropdownOption[]> {
  const response = await fetch('/api/ticketing/users');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch users');
  }

  const result = await response.json();
  return result.data || [];
}

async function fetchTeamsForAssignment(): Promise<TeamDropdownOption[]> {
  const response = await fetch('/api/ticketing/teams?dropdown=true');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch teams');
  }

  const result = await response.json();
  return result.data || [];
}

interface AssignTicketPayload {
  ticketId: string;
  assigned_to?: string | null;
  assigned_team_id?: string | null;
}

async function assignTicketRequest(payload: AssignTicketPayload): Promise<void> {
  const response = await fetch(`/api/ticketing/tickets/${payload.ticketId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assigned_to: payload.assigned_to,
      assigned_team_id: payload.assigned_team_id,
      // Also update status to 'assigned' when assigning
      ...(payload.assigned_to || payload.assigned_team_id ? { status: 'assigned' } : {}),
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to assign ticket');
  }
}

// ==================== Hooks ====================

/**
 * Hook to fetch users for assignment dropdown
 */
export function useUsersForAssignment() {
  const query = useQuery({
    queryKey: assignmentKeys.users,
    queryFn: fetchUsersForAssignment,
    staleTime: 60000, // 1 minute
  });

  return {
    users: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

/**
 * Hook to fetch teams for assignment dropdown
 */
export function useTeamsForAssignment() {
  const query = useQuery({
    queryKey: assignmentKeys.teams,
    queryFn: fetchTeamsForAssignment,
    staleTime: 60000,
  });

  return {
    teams: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

/**
 * Hook to assign ticket to user and/or team
 */
export function useAssignTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: assignTicketRequest,
    onSuccess: (_, variables) => {
      // Invalidate ticket lists and the specific ticket
      queryClient.invalidateQueries({ queryKey: ticketsKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ticketsKeys.detail(variables.ticketId) });
    },
  });
}

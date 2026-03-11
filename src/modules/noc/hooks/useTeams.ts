/**
 * useTeams Hook - Fetch and manage teams
 *
 * Provides React Query hooks for team data fetching and mutations.
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  Team,
  TeamMember,
  TeamDropdownOption,
  UserDropdownOption,
  CreateTeamPayload,
  UpdateTeamPayload,
  AddTeamMemberPayload,
  TeamFilters,
} from '../types/team';

// ==================== Query Keys ====================

export const teamsKeys = {
  all: ['teams'] as const,
  lists: () => [...teamsKeys.all, 'list'] as const,
  list: (filters?: TeamFilters) => [...teamsKeys.lists(), filters] as const,
  dropdown: () => [...teamsKeys.all, 'dropdown'] as const,
  details: () => [...teamsKeys.all, 'detail'] as const,
  detail: (id: string) => [...teamsKeys.details(), id] as const,
  members: (teamId: string) => [...teamsKeys.all, 'members', teamId] as const,
  staffDropdown: () => [...teamsKeys.all, 'staff-dropdown'] as const,
};

// ==================== API Functions ====================

async function fetchTeams(filters?: TeamFilters): Promise<Team[]> {
  const params = new URLSearchParams();

  if (filters) {
    if (filters.team_type) params.append('team_type', filters.team_type);
    if (filters.contractor_id) params.append('contractor_id', filters.contractor_id);
    if (filters.is_active !== undefined) params.append('is_active', String(filters.is_active));
    if (filters.search) params.append('search', filters.search);
  }

  const url = `/api/noc/teams?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch teams');
  }

  const result = await response.json();
  return result.data || [];
}

async function fetchTeamsDropdown(): Promise<TeamDropdownOption[]> {
  const response = await fetch('/api/noc/teams?dropdown=true');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch teams');
  }

  const result = await response.json();
  return result.data || [];
}

async function fetchTeam(id: string): Promise<Team> {
  const response = await fetch(`/api/noc/teams/${id}?include_members=true`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch team');
  }

  const result = await response.json();
  return result.data;
}

async function createTeamRequest(payload: CreateTeamPayload): Promise<Team> {
  const response = await fetch('/api/noc/teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to create team');
  }

  const result = await response.json();
  return result.data;
}

async function updateTeamRequest({
  id,
  payload,
}: {
  id: string;
  payload: UpdateTeamPayload;
}): Promise<Team> {
  const response = await fetch(`/api/noc/teams/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to update team');
  }

  const result = await response.json();
  return result.data;
}

async function deleteTeamRequest(id: string): Promise<Team> {
  const response = await fetch(`/api/noc/teams/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to delete team');
  }

  const result = await response.json();
  return result.data;
}

// ==================== Hooks ====================

/**
 * Hook to fetch teams list with filters
 */
export function useTeams(filters?: TeamFilters) {
  const query = useQuery({
    queryKey: teamsKeys.list(filters),
    queryFn: () => fetchTeams(filters),
    staleTime: 60000, // 1 minute
  });

  return {
    teams: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Hook to fetch teams for dropdown selection
 */
export function useTeamsDropdown() {
  const query = useQuery({
    queryKey: teamsKeys.dropdown(),
    queryFn: fetchTeamsDropdown,
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
 * Hook to fetch single team by ID
 */
export function useTeam(id: string) {
  const query = useQuery({
    queryKey: teamsKeys.detail(id),
    queryFn: () => fetchTeam(id),
    enabled: !!id,
  });

  return {
    team: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

/**
 * Hook to create new team
 */
export function useCreateTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createTeamRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamsKeys.lists() });
      queryClient.invalidateQueries({ queryKey: teamsKeys.dropdown() });
    },
  });
}

/**
 * Hook to update team
 */
export function useUpdateTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateTeamRequest,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: teamsKeys.lists() });
      queryClient.invalidateQueries({ queryKey: teamsKeys.dropdown() });
      queryClient.invalidateQueries({ queryKey: teamsKeys.detail(data.id) });
    },
  });
}

/**
 * Hook to delete team
 */
export function useDeleteTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteTeamRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamsKeys.lists() });
      queryClient.invalidateQueries({ queryKey: teamsKeys.dropdown() });
    },
  });
}

// ==================== Member API Functions ====================

async function fetchTeamMembers(teamId: string): Promise<TeamMember[]> {
  const response = await fetch(`/api/noc/teams/${teamId}/members`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch team members');
  }

  const result = await response.json();
  return result.data || [];
}

async function fetchStaffDropdown(): Promise<UserDropdownOption[]> {
  const response = await fetch('/api/noc/users');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch staff');
  }

  const result = await response.json();
  return result.data || [];
}

async function addTeamMemberRequest({
  teamId,
  payload,
}: {
  teamId: string;
  payload: Omit<AddTeamMemberPayload, 'team_id'>;
}): Promise<TeamMember> {
  const response = await fetch(`/api/noc/teams/${teamId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to add team member');
  }

  const result = await response.json();
  return result.data;
}

async function removeTeamMemberRequest({
  teamId,
  memberId,
}: {
  teamId: string;
  memberId: string;
}): Promise<void> {
  const response = await fetch(
    `/api/noc/teams/${teamId}/members?memberId=${memberId}`,
    { method: 'DELETE' }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to remove team member');
  }
}

// ==================== Member Hooks ====================

/**
 * Hook to fetch members of a specific team
 */
export function useTeamMembers(teamId: string) {
  const query = useQuery({
    queryKey: teamsKeys.members(teamId),
    queryFn: () => fetchTeamMembers(teamId),
    enabled: !!teamId,
    staleTime: 30000,
  });

  return {
    members: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

/**
 * Hook to fetch staff for the member picker dropdown
 */
export function useStaffDropdown() {
  const query = useQuery({
    queryKey: teamsKeys.staffDropdown(),
    queryFn: fetchStaffDropdown,
    staleTime: 60000,
  });

  return {
    staff: query.data || [],
    isLoading: query.isLoading,
  };
}

/**
 * Hook to add a member to a team
 */
export function useAddTeamMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: addTeamMemberRequest,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: teamsKeys.members(variables.teamId) });
      queryClient.invalidateQueries({ queryKey: teamsKeys.lists() });
      queryClient.invalidateQueries({ queryKey: teamsKeys.detail(variables.teamId) });
    },
  });
}

/**
 * Hook to remove a member from a team
 */
export function useRemoveTeamMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: removeTeamMemberRequest,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: teamsKeys.members(variables.teamId) });
      queryClient.invalidateQueries({ queryKey: teamsKeys.lists() });
      queryClient.invalidateQueries({ queryKey: teamsKeys.detail(variables.teamId) });
    },
  });
}

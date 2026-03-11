'use client';

/**
 * useMyTeams Hook - Fetch current user's team memberships
 *
 * Returns the team IDs the current user belongs to,
 * used for the "My Team's Tickets" filter toggle.
 */

import { useQuery } from '@tanstack/react-query';

interface Team {
  id: string;
  name: string;
  team_type: string;
}

async function fetchMyTeams(): Promise<Team[]> {
  const response = await fetch('/api/auth/me/teams');
  if (!response.ok) {
    throw new Error('Failed to fetch teams');
  }
  const result = await response.json();
  return result.data?.teams || [];
}

export function useMyTeams() {
  const query = useQuery({
    queryKey: ['auth', 'me', 'teams'],
    queryFn: fetchMyTeams,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });

  return {
    teams: query.data || [],
    teamIds: (query.data || []).map((t) => t.id),
    isLoading: query.isLoading,
  };
}

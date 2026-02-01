/**
 * useStaffAccess Hook
 * Fetches and caches the current user's staff access level
 */

import { useQuery } from '@tanstack/react-query';
import type { StaffAccessResult } from '@/types/staff/access.types';

interface AccessLevelResponse {
  success: boolean;
  data: StaffAccessResult;
}

/**
 * Fetch access level from the API
 */
async function fetchAccessLevel(staffId?: string): Promise<StaffAccessResult> {
  const url = staffId
    ? `/api/staff/access-level?staffId=${staffId}`
    : '/api/staff/access-level';

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch access level');
  }

  const data: AccessLevelResponse = await response.json();
  return data.data;
}

/**
 * Hook to get the current user's staff access level
 * @param staffId - Optional staff ID to check access for a specific record
 */
export function useStaffAccess(staffId?: string) {
  return useQuery({
    queryKey: ['staffAccess', staffId],
    queryFn: () => fetchAccessLevel(staffId),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  });
}

/**
 * Hook to get the current user's general staff access level (no specific staff record)
 */
export function useStaffAccessLevel() {
  return useStaffAccess();
}

/**
 * Hook to check if user can view sensitive data
 */
export function useCanViewSensitive(staffId?: string) {
  const { data } = useStaffAccess(staffId);
  return data?.canViewSensitive ?? false;
}

/**
 * Hook to check if user can edit sensitive data
 */
export function useCanEditSensitive() {
  const { data } = useStaffAccess();
  return data?.canEditSensitive ?? false;
}

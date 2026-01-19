/**
 * useDRLookup Hook - DR Number Lookup from SOW Module
 *
 * 🟢 WORKING: Production-ready hook for DR number lookup
 *
 * Features:
 * - Lookup DR details from SOW module (drops table)
 * - Returns project, zone, pole, PON, address, GPS
 * - Manual trigger function for form integration
 * - Caching with React Query
 * - Loading and error states
 */

'use client';

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DRLookupData } from '../types/ticket';

// ==================== Query Keys ====================

export const drLookupKeys = {
  all: ['dr-lookup'] as const,
  lookup: (drNumber: string) => [...drLookupKeys.all, drNumber] as const,
};

// ==================== Types ====================

export interface DRLookupAPIResponse {
  success: boolean;
  data?: DRLookupData;
  error?: {
    code: string;
    message: string;
  };
  meta?: {
    timestamp: string;
  };
}

export interface UseDRLookupResult {
  data: DRLookupData | null;
  isLoading: boolean;
  isError: boolean;
  error: string | null;
  isFound: boolean;
  isNotFound: boolean;
  lookup: (drNumber: string) => Promise<DRLookupData | null>;
  clear: () => void;
}

// ==================== API Function ====================

/**
 * 🟢 WORKING: Fetch DR details from API
 */
async function fetchDRLookup(drNumber: string): Promise<DRLookupData | null> {
  const trimmed = drNumber.trim();
  if (!trimmed) {
    return null;
  }

  const response = await fetch(`/api/ticketing/dr-lookup/${encodeURIComponent(trimmed)}`);
  const result: DRLookupAPIResponse = await response.json();

  if (!response.ok) {
    if (response.status === 404) {
      // DR not found - return null, not an error
      return null;
    }
    throw new Error(result.error?.message || 'Failed to lookup DR number');
  }

  if (!result.success || !result.data) {
    return null;
  }

  return result.data;
}

// ==================== React Hook ====================

/**
 * 🟢 WORKING: Hook for DR number lookup with manual trigger
 *
 * @example
 * ```tsx
 * const { data, isLoading, isFound, lookup, clear } = useDRLookup();
 *
 * // Manual lookup
 * const handleLookup = async () => {
 *   const result = await lookup('DR001234');
 *   if (result) {
 *     // Auto-populate form fields
 *     setProjectId(result.project_id);
 *     setZoneId(result.zone_number?.toString());
 *     // etc.
 *   }
 * };
 * ```
 */
export function useDRLookup(): UseDRLookupResult {
  const queryClient = useQueryClient();
  const [currentDR, setCurrentDR] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DRLookupData | null>(null);
  const [lookupAttempted, setLookupAttempted] = useState(false);

  /**
   * Manual lookup function - triggers API call
   */
  const lookup = useCallback(async (drNumber: string): Promise<DRLookupData | null> => {
    const trimmed = drNumber.trim();
    if (!trimmed) {
      setError('DR number is required');
      return null;
    }

    setIsLoading(true);
    setError(null);
    setCurrentDR(trimmed);
    setLookupAttempted(true);

    try {
      // Check cache first
      const cachedData = queryClient.getQueryData<DRLookupData>(
        drLookupKeys.lookup(trimmed)
      );

      if (cachedData) {
        setData(cachedData);
        setIsLoading(false);
        return cachedData;
      }

      // Fetch from API
      const result = await fetchDRLookup(trimmed);

      // Cache the result
      if (result) {
        queryClient.setQueryData(drLookupKeys.lookup(trimmed), result);
      }

      setData(result);
      setIsLoading(false);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to lookup DR number';
      setError(errorMessage);
      setData(null);
      setIsLoading(false);
      return null;
    }
  }, [queryClient]);

  /**
   * Clear lookup state
   */
  const clear = useCallback(() => {
    setCurrentDR(null);
    setData(null);
    setError(null);
    setLookupAttempted(false);
  }, []);

  return {
    data,
    isLoading,
    isError: !!error,
    error,
    isFound: lookupAttempted && data !== null,
    isNotFound: lookupAttempted && !isLoading && data === null && !error,
    lookup,
    clear,
  };
}

/**
 * 🟢 WORKING: Hook for auto-lookup on DR number change
 * Use this when you want automatic lookup as user types
 *
 * @param drNumber - DR number to lookup (debounced externally)
 * @param enabled - Whether to enable lookup
 */
export function useDRLookupAuto(drNumber: string, enabled = true) {
  const query = useQuery({
    queryKey: drLookupKeys.lookup(drNumber),
    queryFn: () => fetchDRLookup(drNumber),
    enabled: enabled && drNumber.trim().length >= 3,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    retry: false, // Don't retry on 404
  });

  return {
    data: query.data || null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error?.message || null,
    isFound: query.isSuccess && query.data !== null,
    isNotFound: query.isSuccess && query.data === null,
  };
}

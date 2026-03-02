/**
 * Tool Checkout Hooks
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import type { ToolCheckout } from '@/types/stockItem.types';
import { log } from '@/lib/logger';

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error?.message || 'Failed to fetch');
  }
  return res.json();
};

/** Fetch all active checkouts */
export function useActiveCheckouts() {
  const { data, error, isLoading, refetch } = useQuery<{ success: boolean; data: ToolCheckout[] }>({
    queryKey: ['tool-checkouts', 'active'],
    queryFn: () => fetcher('/api/stock-items/checkouts'),
    staleTime: 15 * 1000,
  });

  return {
    checkouts: data?.data || [],
    total: data?.data?.length || 0,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}

/** Fetch overdue checkouts */
export function useOverdueCheckouts() {
  const { data, error, isLoading, refetch } = useQuery<{ success: boolean; data: ToolCheckout[] }>({
    queryKey: ['tool-checkouts', 'overdue'],
    queryFn: () => fetcher('/api/stock-items/checkouts?overdue=true'),
    staleTime: 30 * 1000,
  });

  return {
    checkouts: data?.data || [],
    total: data?.data?.length || 0,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}

/** Check out and check in mutations */
export function useToolCheckoutMutations() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const checkOut = useCallback(async (input: {
    stockItemId: string;
    jobSiteName: string;
    jobSiteId?: string;
    expectedReturnDate: string;
  }): Promise<ToolCheckout | null> => {
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/stock-items/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to check out item');
      }

      queryClient.invalidateQueries({ queryKey: ['tool-checkouts'] });
      queryClient.invalidateQueries({ queryKey: ['stock-items'] });
      return data.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      log.error('Checkout failed', { error: err }, 'useToolCheckouts');
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, [queryClient]);

  const checkIn = useCallback(async (input: {
    checkoutId: string;
    conditionNotes?: string;
  }): Promise<ToolCheckout | null> => {
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/stock-items/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to check in item');
      }

      queryClient.invalidateQueries({ queryKey: ['tool-checkouts'] });
      queryClient.invalidateQueries({ queryKey: ['stock-items'] });
      return data.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      log.error('Checkin failed', { error: err }, 'useToolCheckouts');
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, [queryClient]);

  return {
    checkOut,
    checkIn,
    isSubmitting,
    error,
    clearError: () => setError(null),
  };
}

/**
 * Stock Items Hooks
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import type {
  StockItem,
  StockItemsResponse,
  StockItemFilters,
  CreateStockItemInput,
  UpdateStockItemInput,
} from '@/types/stockItem.types';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to fetch');
  }
  return res.json();
};

export function useStockItems(filters: StockItemFilters = {}) {
  const params = new URLSearchParams();

  if (filters.search) params.set('search', filters.search);
  if (filters.category) params.set('category', filters.category);
  if (filters.hasStock) params.set('hasStock', 'true');
  if (filters.odooOnly) params.set('odooOnly', 'true');
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.sortBy) params.set('sortBy', filters.sortBy);
  if (filters.sortOrder) params.set('sortOrder', filters.sortOrder);

  const queryString = params.toString();
  const url = `/api/stock-items${queryString ? `?${queryString}` : ''}`;

  const { data, error, isLoading, refetch } = useQuery<StockItemsResponse>({
    queryKey: ['stock-items', filters],
    queryFn: () => fetcher(url),
    staleTime: 30 * 1000, // 30 seconds
  });

  return {
    items: data?.data || [],
    pagination: data?.pagination,
    categories: data?.filters?.categories || [],
    isLoading,
    error: error as Error | null,
    mutate: refetch,
  };
}

export function useStockItem(itemId: string | null) {
  const { data, error, isLoading, refetch } = useQuery<{ data: StockItem }>({
    queryKey: ['stock-items', itemId],
    queryFn: () => fetcher(`/api/stock-items/${itemId}`),
    enabled: !!itemId,
  });

  return {
    item: data?.data,
    isLoading,
    error: error as Error | null,
    mutate: refetch,
  };
}

export function useStockItemMutations() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const createItem = useCallback(async (input: CreateStockItemInput): Promise<StockItem | null> => {
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/stock-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create stock item');
      }

      queryClient.invalidateQueries({ queryKey: ['stock-items'] });
      return data.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, [queryClient]);

  const updateItem = useCallback(async (input: UpdateStockItemInput): Promise<StockItem | null> => {
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/stock-items/${input.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to update stock item');
      }

      queryClient.invalidateQueries({ queryKey: ['stock-items'] });
      queryClient.invalidateQueries({ queryKey: ['stock-items', input.id] });
      return data.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, [queryClient]);

  const deleteItem = useCallback(async (itemId: string, force = false): Promise<boolean> => {
    setIsSubmitting(true);
    setError(null);

    try {
      const url = force ? `/api/stock-items/${itemId}?force=true` : `/api/stock-items/${itemId}`;
      const res = await fetch(url, { method: 'DELETE' });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete stock item');
      }

      queryClient.invalidateQueries({ queryKey: ['stock-items'] });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [queryClient]);

  return {
    createItem,
    updateItem,
    deleteItem,
    isSubmitting,
    error,
    clearError: () => setError(null),
  };
}

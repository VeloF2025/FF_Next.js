/**
 * useStockItems Hook
 * Operations for stock item master data
 */

import { useState, useCallback, useEffect } from 'react';
import { log } from '@/lib/logger';
import type { StockItem, ItemCategory, TrackingType } from '../types';

interface StockItemFilters {
  category?: ItemCategory;
  trackingType?: TrackingType;
  isActive?: boolean;
  search?: string;
}

interface UseStockItemsOptions {
  filters?: StockItemFilters;
  autoFetch?: boolean;
}

interface CreateStockItemInput {
  itemCode: string;
  name: string;
  description?: string;
  category: ItemCategory;
  trackingType: TrackingType;
  uom?: string;
  standardCost?: number;
  currency?: string;
  minStockLevel?: number;
  maxStockLevel?: number;
  reorderQuantity?: number;
  isReturnable?: boolean;
}

interface UseStockItemsReturn {
  items: StockItem[];
  loading: boolean;
  error: string | null;
  fetchItems: (filters?: StockItemFilters) => Promise<void>;
  createItem: (input: CreateStockItemInput) => Promise<StockItem>;
  refresh: () => Promise<void>;
}

export function useStockItems(options: UseStockItemsOptions = {}): UseStockItemsReturn {
  const { filters: initialFilters, autoFetch = true } = options;

  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentFilters, setCurrentFilters] = useState<StockItemFilters | undefined>(initialFilters);

  const fetchItems = useCallback(async (filters?: StockItemFilters) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      const activeFilters = filters || currentFilters;

      if (activeFilters) {
        if (activeFilters.category) {
          params.append('category', activeFilters.category);
        }
        if (activeFilters.trackingType) {
          params.append('trackingType', activeFilters.trackingType);
        }
        if (activeFilters.isActive !== undefined) {
          params.append('isActive', String(activeFilters.isActive));
        }
        if (activeFilters.search) {
          params.append('search', activeFilters.search);
        }
      }

      const queryString = params.toString();
      const url = `/api/procurement/field-stock/items${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to fetch stock items');
      }

      setItems(result.data);
      setCurrentFilters(filters || currentFilters);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch stock items';
      setError(message);
      log.error('Failed to fetch stock items', err, 'useStockItems');
    } finally {
      setLoading(false);
    }
  }, [currentFilters]);

  const createItem = useCallback(async (input: CreateStockItemInput): Promise<StockItem> => {
    try {
      const response = await fetch('/api/procurement/field-stock/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to create stock item');
      }

      // Refresh the list
      await fetchItems();

      return result.data;
    } catch (err) {
      log.error('Failed to create stock item', err, 'useStockItems');
      throw err;
    }
  }, [fetchItems]);

  const refresh = useCallback(async () => {
    await fetchItems(currentFilters);
  }, [fetchItems, currentFilters]);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch) {
      fetchItems(initialFilters);
    }
  }, [autoFetch, fetchItems, initialFilters]);

  return {
    items,
    loading,
    error,
    fetchItems,
    createItem,
    refresh,
  };
}

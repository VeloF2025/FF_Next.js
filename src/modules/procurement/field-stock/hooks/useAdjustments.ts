/**
 * useAdjustments Hook
 * Manage stock quantity adjustments (increase/decrease)
 */

import { useState, useCallback, useEffect } from 'react';
import type { AdjustmentReason } from '@/types/procurement/stockTake.types';

interface StockAdjustment {
  id: string;
  stock_item_id: string;
  from_location_id?: string;
  to_location_id?: string;
  quantity: number;
  reference: string;
  notes?: string;
  performed_by?: string;
  performed_at: string;
  item_code?: string;
  item_name?: string;
  from_location_name?: string;
  to_location_name?: string;
}

interface CreateAdjustmentInput {
  stock_item_id: string;
  location_id: string;
  adjustment_type: 'increase' | 'decrease';
  quantity: number;
  reason_code: string;
  notes?: string;
  performed_by?: string;
}

interface AdjustmentFilters {
  location_id?: string;
  reason_code?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
}

interface UseAdjustmentsOptions {
  autoFetch?: boolean;
  defaultFilters?: AdjustmentFilters;
}

interface UseAdjustmentsReturn {
  adjustments: StockAdjustment[];
  loading: boolean;
  error: string | null;
  reasons: AdjustmentReason[];
  refresh: (filters?: AdjustmentFilters) => Promise<void>;
  createAdjustment: (input: CreateAdjustmentInput) => Promise<StockAdjustment>;
  fetchReasons: () => Promise<void>;
}

const API_BASE = '/api/procurement/adjustments';
const REASONS_API = '/api/procurement/stock-takes/reasons';

export function useAdjustments(options: UseAdjustmentsOptions = {}): UseAdjustmentsReturn {
  const { autoFetch = false, defaultFilters = {} } = options;
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [reasons, setReasons] = useState<AdjustmentReason[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAdjustments = useCallback(async (filters: AdjustmentFilters = defaultFilters) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.location_id) params.set('location_id', filters.location_id);
      if (filters.reason_code) params.set('reason_code', filters.reason_code);
      if (filters.date_from) params.set('date_from', filters.date_from);
      if (filters.date_to) params.set('date_to', filters.date_to);
      if (filters.limit) params.set('limit', String(filters.limit));

      const url = params.toString() ? `${API_BASE}?${params.toString()}` : API_BASE;
      const response = await fetch(url);

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to fetch adjustments');
      }

      const data = await response.json();
      setAdjustments(data.data || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch adjustments';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [defaultFilters]);

  const createAdjustment = useCallback(async (input: CreateAdjustmentInput): Promise<StockAdjustment> => {
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to create adjustment');
    }

    const data = await response.json();
    const newAdj = data.data as StockAdjustment;
    setAdjustments(prev => [newAdj, ...prev]);
    return newAdj;
  }, []);

  const fetchReasons = useCallback(async () => {
    try {
      const response = await fetch(`${REASONS_API}?is_active=true`);
      if (!response.ok) return;
      const data = await response.json();
      setReasons(data.data || []);
    } catch (err) {
      // Non-critical - reasons are for UI convenience
    }
  }, []);

  useEffect(() => {
    if (autoFetch) {
      fetchAdjustments();
      fetchReasons();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch]);

  return {
    adjustments,
    loading,
    error,
    reasons,
    refresh: fetchAdjustments,
    createAdjustment,
    fetchReasons,
  };
}

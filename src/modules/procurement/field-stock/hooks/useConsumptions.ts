/**
 * useConsumptions Hook
 * Operations for recording material consumption on jobs
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { log } from '@/lib/logger';
import type {
  StockConsumption,
  RecordConsumptionInput,
  ConsumptionFilters,
} from '../types';

interface UseConsumptionsOptions {
  filters?: ConsumptionFilters;
  autoFetch?: boolean;
}

interface UseConsumptionsReturn {
  consumptions: StockConsumption[];
  loading: boolean;
  error: string | null;
  fetchConsumptions: (filters?: ConsumptionFilters) => Promise<void>;
  recordConsumption: (input: RecordConsumptionInput) => Promise<StockConsumption>;
  verifyConsumption: (consumptionId: string, verifiedBy: string) => Promise<StockConsumption>;
  getConsumptionsByDrop: (dropNumber: string) => Promise<StockConsumption[]>;
  getConsumptionsByTechnician: (technicianId: string) => Promise<StockConsumption[]>;
  refresh: () => Promise<void>;
}

export function useConsumptions(options: UseConsumptionsOptions = {}): UseConsumptionsReturn {
  const { filters: initialFilters, autoFetch = false } = options;

  const [consumptions, setConsumptions] = useState<StockConsumption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentFilters, setCurrentFilters] = useState<ConsumptionFilters | undefined>(initialFilters);

  const fetchConsumptions = useCallback(async (filters?: ConsumptionFilters) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      const activeFilters = filters || currentFilters;

      if (activeFilters) {
        if (activeFilters.jobType) {
          params.append('jobType', activeFilters.jobType);
        }
        if (activeFilters.dropNumber) {
          params.append('dropNumber', activeFilters.dropNumber);
        }
        if (activeFilters.technicianId) {
          params.append('technicianId', activeFilters.technicianId);
        }
        if (activeFilters.verified !== undefined) {
          params.append('verified', String(activeFilters.verified));
        }
        if (activeFilters.dateFrom) {
          params.append('dateFrom', activeFilters.dateFrom.toISOString());
        }
        if (activeFilters.dateTo) {
          params.append('dateTo', activeFilters.dateTo.toISOString());
        }
      }

      const queryString = params.toString();
      const url = `/api/procurement/field-stock/consumptions${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to fetch consumptions');
      }

      setConsumptions(result.data);
      setCurrentFilters(filters || currentFilters);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch consumptions';
      setError(message);
      log.error('Failed to fetch consumptions', err, 'useConsumptions');
    } finally {
      setLoading(false);
    }
  }, [currentFilters]);

  const recordConsumption = useCallback(async (input: RecordConsumptionInput): Promise<StockConsumption> => {
    try {
      const response = await fetch('/api/procurement/field-stock/consumptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to record consumption');
      }

      // Refresh the list
      await fetchConsumptions();

      return result.data;
    } catch (err) {
      log.error('Failed to record consumption', err, 'useConsumptions');
      throw err;
    }
  }, [fetchConsumptions]);

  const verifyConsumption = useCallback(async (
    consumptionId: string,
    verifiedBy: string
  ): Promise<StockConsumption> => {
    try {
      const response = await fetch(`/api/procurement/field-stock/consumptions/${consumptionId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verifiedBy }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to verify consumption');
      }

      // Refresh the list
      await fetchConsumptions();

      return result.data;
    } catch (err) {
      log.error('Failed to verify consumption', err, 'useConsumptions');
      throw err;
    }
  }, [fetchConsumptions]);

  const getConsumptionsByDrop = useCallback(async (dropNumber: string): Promise<StockConsumption[]> => {
    try {
      const response = await fetch(
        `/api/procurement/field-stock/consumptions?dropNumber=${encodeURIComponent(dropNumber)}`
      );
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to fetch consumptions');
      }

      return result.data;
    } catch (err) {
      log.error('Failed to fetch consumptions by drop', err, 'useConsumptions');
      throw err;
    }
  }, []);

  const getConsumptionsByTechnician = useCallback(async (technicianId: string): Promise<StockConsumption[]> => {
    try {
      const response = await fetch(
        `/api/procurement/field-stock/consumptions?technicianId=${encodeURIComponent(technicianId)}`
      );
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to fetch consumptions');
      }

      return result.data;
    } catch (err) {
      log.error('Failed to fetch consumptions by technician', err, 'useConsumptions');
      throw err;
    }
  }, []);

  const refresh = useCallback(async () => {
    await fetchConsumptions(currentFilters);
  }, [fetchConsumptions, currentFilters]);

  // Track if initial fetch has been done
  const hasFetched = useRef(false);

  // Auto-fetch on mount if enabled (only once)
  useEffect(() => {
    if (autoFetch && !hasFetched.current) {
      hasFetched.current = true;
      fetchConsumptions(initialFilters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch]);

  return {
    consumptions,
    loading,
    error,
    fetchConsumptions,
    recordConsumption,
    verifyConsumption,
    getConsumptionsByDrop,
    getConsumptionsByTechnician,
    refresh,
  };
}

/**
 * useSerials Hook
 * Operations for serial number tracking
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { log } from '@/lib/logger';
import type {
  StockSerial,
  RegisterSerialInput,
  SerialFilters,
  SerialStatus,
} from '../types';

interface UseSerialsOptions {
  filters?: SerialFilters;
  autoFetch?: boolean;
}

interface UseSerialsReturn {
  serials: StockSerial[];
  loading: boolean;
  error: string | null;
  fetchSerials: (filters?: SerialFilters) => Promise<void>;
  getSerial: (serialNumber: string) => Promise<StockSerial | null>;
  getSerialWithHistory: (serialNumber: string) => Promise<StockSerial & { history: unknown[] } | null>;
  registerSerial: (input: RegisterSerialInput) => Promise<StockSerial>;
  updateSerialStatus: (serialNumber: string, status: SerialStatus, locationId?: string) => Promise<StockSerial>;
  refresh: () => Promise<void>;
}

export function useSerials(options: UseSerialsOptions = {}): UseSerialsReturn {
  const { filters: initialFilters, autoFetch = true } = options;

  const [serials, setSerials] = useState<StockSerial[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentFilters, setCurrentFilters] = useState<SerialFilters | undefined>(initialFilters);

  const fetchSerials = useCallback(async (filters?: SerialFilters) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      const activeFilters = filters || currentFilters;

      if (activeFilters) {
        if (activeFilters.stockItemId) {
          params.append('stockItemId', activeFilters.stockItemId);
        }
        if (activeFilters.status) {
          params.append('status', activeFilters.status);
        }
        if (activeFilters.locationId) {
          params.append('locationId', activeFilters.locationId);
        }
        if (activeFilters.search) {
          params.append('search', activeFilters.search);
        }
      }

      const queryString = params.toString();
      const url = `/api/procurement/field-stock/serials${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to fetch serials');
      }

      setSerials(result.data);
      setCurrentFilters(filters || currentFilters);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch serials';
      setError(message);
      log.error('Failed to fetch serials', err, 'useSerials');
    } finally {
      setLoading(false);
    }
  }, [currentFilters]);

  const getSerial = useCallback(async (serialNumber: string): Promise<StockSerial | null> => {
    try {
      const response = await fetch(`/api/procurement/field-stock/serials/${encodeURIComponent(serialNumber)}`);
      const result = await response.json();

      if (!result.success) {
        if (response.status === 404) return null;
        throw new Error(result.error?.message || 'Failed to fetch serial');
      }

      return result.data;
    } catch (err) {
      log.error('Failed to fetch serial', err, 'useSerials');
      throw err;
    }
  }, []);

  const getSerialWithHistory = useCallback(async (
    serialNumber: string
  ): Promise<StockSerial & { history: unknown[] } | null> => {
    try {
      const response = await fetch(
        `/api/procurement/field-stock/serials/${encodeURIComponent(serialNumber)}?includeHistory=true`
      );
      const result = await response.json();

      if (!result.success) {
        if (response.status === 404) return null;
        throw new Error(result.error?.message || 'Failed to fetch serial');
      }

      return result.data;
    } catch (err) {
      log.error('Failed to fetch serial with history', err, 'useSerials');
      throw err;
    }
  }, []);

  const registerSerial = useCallback(async (input: RegisterSerialInput): Promise<StockSerial> => {
    try {
      const response = await fetch('/api/procurement/field-stock/serials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to register serial');
      }

      // Refresh the list
      await fetchSerials();

      return result.data;
    } catch (err) {
      log.error('Failed to register serial', err, 'useSerials');
      throw err;
    }
  }, [fetchSerials]);

  const updateSerialStatus = useCallback(async (
    serialNumber: string,
    status: SerialStatus,
    locationId?: string
  ): Promise<StockSerial> => {
    try {
      const response = await fetch(`/api/procurement/field-stock/serials/${encodeURIComponent(serialNumber)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, locationId }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to update serial status');
      }

      // Refresh the list
      await fetchSerials();

      return result.data;
    } catch (err) {
      log.error('Failed to update serial status', err, 'useSerials');
      throw err;
    }
  }, [fetchSerials]);

  const refresh = useCallback(async () => {
    await fetchSerials(currentFilters);
  }, [fetchSerials, currentFilters]);

  // Track if initial fetch has been done
  const hasFetched = useRef(false);

  // Auto-fetch on mount if enabled (only once)
  useEffect(() => {
    if (autoFetch && !hasFetched.current) {
      hasFetched.current = true;
      fetchSerials(initialFilters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch]);

  return {
    serials,
    loading,
    error,
    fetchSerials,
    getSerial,
    getSerialWithHistory,
    registerSerial,
    updateSerialStatus,
    refresh,
  };
}

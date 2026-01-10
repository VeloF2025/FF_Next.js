/**
 * useLocations Hook
 * CRUD operations for stock locations
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { log } from '@/lib/logger';
import type {
  StockLocation,
  CreateLocationInput,
  UpdateLocationInput,
  LocationFilters,
} from '../types';

interface UseLocationsOptions {
  filters?: LocationFilters;
  autoFetch?: boolean;
}

interface UseLocationsReturn {
  locations: StockLocation[];
  loading: boolean;
  error: string | null;
  fetchLocations: (filters?: LocationFilters) => Promise<void>;
  getLocation: (id: string) => Promise<StockLocation | null>;
  createLocation: (input: CreateLocationInput) => Promise<StockLocation>;
  updateLocation: (id: string, input: UpdateLocationInput) => Promise<StockLocation>;
  deleteLocation: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useLocations(options: UseLocationsOptions = {}): UseLocationsReturn {
  const { filters: initialFilters, autoFetch = true } = options;

  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentFilters, setCurrentFilters] = useState<LocationFilters | undefined>(initialFilters);

  const fetchLocations = useCallback(async (filters?: LocationFilters) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      const activeFilters = filters || currentFilters;

      if (activeFilters) {
        if (activeFilters.locationType) {
          params.append('locationType', activeFilters.locationType);
        }
        if (activeFilters.projectId) {
          params.append('projectId', activeFilters.projectId);
        }
        if (activeFilters.assignedToId) {
          params.append('assignedToId', activeFilters.assignedToId);
        }
        if (activeFilters.isActive !== undefined) {
          params.append('isActive', String(activeFilters.isActive));
        }
        if (activeFilters.search) {
          params.append('search', activeFilters.search);
        }
      }

      const queryString = params.toString();
      const url = `/api/procurement/field-stock/locations${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to fetch locations');
      }

      setLocations(result.data);
      setCurrentFilters(filters || currentFilters);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch locations';
      setError(message);
      log.error('Failed to fetch locations', err, 'useLocations');
    } finally {
      setLoading(false);
    }
  }, [currentFilters]);

  const getLocation = useCallback(async (id: string): Promise<StockLocation | null> => {
    try {
      const response = await fetch(`/api/procurement/field-stock/locations/${id}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to fetch location');
      }

      return result.data;
    } catch (err) {
      log.error('Failed to fetch location', err, 'useLocations');
      throw err;
    }
  }, []);

  const createLocation = useCallback(async (input: CreateLocationInput): Promise<StockLocation> => {
    try {
      const response = await fetch('/api/procurement/field-stock/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to create location');
      }

      // Refresh the list
      await fetchLocations();

      return result.data;
    } catch (err) {
      log.error('Failed to create location', err, 'useLocations');
      throw err;
    }
  }, [fetchLocations]);

  const updateLocation = useCallback(async (
    id: string,
    input: UpdateLocationInput
  ): Promise<StockLocation> => {
    try {
      const response = await fetch(`/api/procurement/field-stock/locations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to update location');
      }

      // Refresh the list
      await fetchLocations();

      return result.data;
    } catch (err) {
      log.error('Failed to update location', err, 'useLocations');
      throw err;
    }
  }, [fetchLocations]);

  const deleteLocation = useCallback(async (id: string): Promise<void> => {
    try {
      const response = await fetch(`/api/procurement/field-stock/locations/${id}`, {
        method: 'DELETE',
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to delete location');
      }

      // Refresh the list
      await fetchLocations();
    } catch (err) {
      log.error('Failed to delete location', err, 'useLocations');
      throw err;
    }
  }, [fetchLocations]);

  const refresh = useCallback(async () => {
    await fetchLocations(currentFilters);
  }, [fetchLocations, currentFilters]);

  // Track if initial fetch has been done
  const hasFetched = useRef(false);

  // Auto-fetch on mount if enabled (only once)
  useEffect(() => {
    if (autoFetch && !hasFetched.current) {
      hasFetched.current = true;
      fetchLocations(initialFilters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch]);

  return {
    locations,
    loading,
    error,
    fetchLocations,
    getLocation,
    createLocation,
    updateLocation,
    deleteLocation,
    refresh,
  };
}

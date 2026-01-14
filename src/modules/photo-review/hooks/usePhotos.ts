/**
 * Photos Hook
 * Custom hook for fetching and filtering DR photos
 */

import { useState, useEffect, useCallback } from 'react';
import type { DropRecord, PhotoFilters } from '../types';
import * as api from '../services/fotoEvaluationService';

export interface UsePhotosReturn {
  /** List of DRs with photos */
  photos: DropRecord[];
  /** Whether photos are being loaded */
  isLoading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Refresh photos list */
  refresh: () => Promise<void>;
  /** Apply filters */
  applyFilters: (filters: PhotoFilters) => void;
  /** Current filters */
  filters: PhotoFilters | undefined;
}

/**
 * Hook for fetching DR photos with filtering
 * Automatically fetches on mount and when filters change
 */
export function usePhotos(initialFilters?: PhotoFilters): UsePhotosReturn {
  const [photos, setPhotos] = useState<DropRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<PhotoFilters | undefined>(initialFilters);

  /**
   * Fetch photos from API
   */
  const fetchPhotos = useCallback(async (currentFilters?: PhotoFilters) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await api.fetchPhotos(currentFilters);
      setPhotos(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch photos';
      setError(errorMessage);
      setPhotos([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Refresh photos list
   */
  const refresh = useCallback(async () => {
    await fetchPhotos(filters);
  }, [filters, fetchPhotos]);

  /**
   * Apply new filters
   */
  const applyFilters = useCallback((newFilters: PhotoFilters) => {
    setFilters(newFilters);
  }, []);

  /**
   * Fetch on mount and when filters change
   */
  useEffect(() => {
    fetchPhotos(filters);
  }, [filters, fetchPhotos]);

  return {
    photos,
    isLoading,
    error,
    refresh,
    applyFilters,
    filters,
  };
}

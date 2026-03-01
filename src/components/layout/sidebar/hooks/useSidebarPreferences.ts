'use client';

import { useState, useEffect, useCallback } from 'react';
import { log } from '@/lib/logger';

const DEFAULT_ITEMS = ['communications', 'action-items'];

interface UseSidebarPreferencesReturn {
  mainSectionItems: string[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch and cache user sidebar preferences
 * Returns the list of item IDs that should appear in the MAIN section
 */
export function useSidebarPreferences(): UseSidebarPreferencesReturn {
  const [mainSectionItems, setMainSectionItems] = useState<string[]>(DEFAULT_ITEMS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPreferences = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch('/api/user-sidebar-preferences');
      if (!res.ok) {
        throw new Error('Failed to fetch preferences');
      }
      const data = await res.json();
      if (data.success) {
        setMainSectionItems(data.data.main_section_items || DEFAULT_ITEMS);
      }
    } catch (err) {
      log.error('Failed to fetch sidebar preferences', err, 'useSidebarPreferences');
      setError(err instanceof Error ? err.message : 'Unknown error');
      // Keep using defaults on error
      setMainSectionItems(DEFAULT_ITEMS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  return {
    mainSectionItems,
    loading,
    error,
    refetch: fetchPreferences,
  };
}

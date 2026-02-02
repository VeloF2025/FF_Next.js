/**
 * useStaffFeatures Hook
 * Client-side hook for checking Staff module feature settings
 *
 * Usage:
 *   const { isFeatureEnabled, isLoading } = useStaffFeatures();
 *
 *   if (isFeatureEnabled('people.staff.tabs.performance')) { ... }
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { log } from '@/lib/logger';

interface FeatureSetting {
  feature_key: string;
  enabled: boolean;
  config: Record<string, unknown>;
  updated_at: string;
}

interface UseStaffFeaturesReturn {
  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled: (featureKey: string) => boolean;

  /**
   * Get all feature settings
   */
  features: FeatureSetting[];

  /**
   * Loading state while fetching features
   */
  isLoading: boolean;

  /**
   * Error message if fetch failed
   */
  error: string | null;

  /**
   * Refresh features from server
   */
  refresh: () => Promise<void>;
}

export function useStaffFeatures(): UseStaffFeaturesReturn {
  const [features, setFeatures] = useState<FeatureSetting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFeatures = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/settings/system/features');

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          // Filter to only staff-related features
          const staffFeatures = (data.data || []).filter(
            (f: FeatureSetting) => f.feature_key.startsWith('people.staff')
          );
          setFeatures(staffFeatures);
        } else {
          throw new Error(data.error?.message || 'Failed to fetch features');
        }
      } else {
        throw new Error('Failed to fetch feature settings');
      }
    } catch (err) {
      log.error('useStaffFeatures', 'Failed to fetch features', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch features');
      // On error, default to all features enabled
      setFeatures([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeatures();
  }, [fetchFeatures]);

  // Build feature lookup map
  const featureMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const feature of features) {
      map.set(feature.feature_key, feature.enabled);
    }
    return map;
  }, [features]);

  // Check if feature is enabled
  const isFeatureEnabled = useCallback(
    (featureKey: string): boolean => {
      // If still loading or feature not found, default to enabled
      if (isLoading) return true;

      const enabled = featureMap.get(featureKey);
      // If not in the map, default to enabled
      return enabled !== undefined ? enabled : true;
    },
    [featureMap, isLoading]
  );

  return {
    isFeatureEnabled,
    features,
    isLoading,
    error,
    refresh: fetchFeatures,
  };
}

export default useStaffFeatures;

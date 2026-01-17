/**
 * useAutoRefresh Hook
 *
 * Visibility-aware background polling for auto-refreshing data.
 * Features:
 * - Pauses when tab is hidden (Page Visibility API)
 * - Prevents concurrent requests
 * - Silent updates (no loading spinners)
 * - Configurable interval
 * - Error resilience
 */

import { useEffect, useRef, useCallback } from 'react';

interface UseAutoRefreshOptions {
  /** Refresh interval in milliseconds (default: 30000 = 30 seconds) */
  interval?: number;
  /** Whether auto-refresh is enabled (default: true) */
  enabled?: boolean;
  /** Callback when refresh starts */
  onRefreshStart?: () => void;
  /** Callback when refresh completes */
  onRefreshComplete?: () => void;
  /** Callback when refresh fails */
  onRefreshError?: (error: Error) => void;
}

interface UseAutoRefreshReturn {
  /** Manually trigger a refresh */
  refresh: () => Promise<void>;
  /** Whether a refresh is currently in progress */
  isRefreshing: boolean;
  /** Last successful refresh timestamp */
  lastRefreshAt: Date | null;
  /** Pause auto-refresh */
  pause: () => void;
  /** Resume auto-refresh */
  resume: () => void;
  /** Whether auto-refresh is currently paused */
  isPaused: boolean;
}

export function useAutoRefresh(
  fetchFn: () => Promise<void>,
  options: UseAutoRefreshOptions = {}
): UseAutoRefreshReturn {
  const {
    interval = 30000,
    enabled = true,
    onRefreshStart,
    onRefreshComplete,
    onRefreshError,
  } = options;

  // Refs to track state without causing re-renders
  const isRefreshingRef = useRef(false);
  const lastRefreshAtRef = useRef<Date | null>(null);
  const isPausedRef = useRef(false);
  const intervalIdRef = useRef<NodeJS.Timeout | null>(null);
  const isVisibleRef = useRef(true);

  // Track if component is mounted
  const isMountedRef = useRef(true);

  // The actual refresh function
  const doRefresh = useCallback(async () => {
    // Skip if already refreshing, paused, or tab is hidden
    if (isRefreshingRef.current || isPausedRef.current || !isVisibleRef.current) {
      return;
    }

    try {
      isRefreshingRef.current = true;
      onRefreshStart?.();

      await fetchFn();

      if (isMountedRef.current) {
        lastRefreshAtRef.current = new Date();
        onRefreshComplete?.();
      }
    } catch (error) {
      if (isMountedRef.current) {
        onRefreshError?.(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      if (isMountedRef.current) {
        isRefreshingRef.current = false;
      }
    }
  }, [fetchFn, onRefreshStart, onRefreshComplete, onRefreshError]);

  // Handle visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      isVisibleRef.current = document.visibilityState === 'visible';

      // If tab becomes visible and enough time has passed, refresh immediately
      if (isVisibleRef.current && lastRefreshAtRef.current) {
        const timeSinceLastRefresh = Date.now() - lastRefreshAtRef.current.getTime();
        if (timeSinceLastRefresh >= interval) {
          doRefresh();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [interval, doRefresh]);

  // Set up the interval
  useEffect(() => {
    if (!enabled) {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
      return;
    }

    // Start the interval
    intervalIdRef.current = setInterval(() => {
      if (!isPausedRef.current && isVisibleRef.current) {
        doRefresh();
      }
    }, interval);

    return () => {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
    };
  }, [enabled, interval, doRefresh]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Control functions
  const pause = useCallback(() => {
    isPausedRef.current = true;
  }, []);

  const resume = useCallback(() => {
    isPausedRef.current = false;
  }, []);

  const refresh = useCallback(async () => {
    await doRefresh();
  }, [doRefresh]);

  return {
    refresh,
    isRefreshing: isRefreshingRef.current,
    lastRefreshAt: lastRefreshAtRef.current,
    pause,
    resume,
    isPaused: isPausedRef.current,
  };
}

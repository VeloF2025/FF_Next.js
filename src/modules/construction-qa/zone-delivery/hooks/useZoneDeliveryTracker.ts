import { useCallback, useEffect, useRef, useState } from 'react';
import type { TrackerResult } from '../types/zoneDelivery.types';

interface TrackerResponse {
  success: boolean;
  data?: TrackerResult;
  error?: { message?: string };
}

export interface ZoneDeliveryTrackerState {
  data: TrackerResult | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
}

const FAILED = 'Unable to load the delivery tracker.';

export function useZoneDeliveryTracker(projectId?: string): ZoneDeliveryTrackerState {
  const [data, setData] = useState<TrackerResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (isRefresh: boolean) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    if (isRefresh) setRefreshing(true);
    else {
      setData(null);
      setLastUpdated(null);
      setLoading(true);
    }
    try {
      const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
      const response = await fetch(`/api/zone-delivery/tracker${query}`, {
        credentials: 'include',
        signal: controller.signal,
      });
      const payload = await response.json() as TrackerResponse;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error?.message || FAILED);
      }
      if (controllerRef.current === controller) {
        setData(payload.data);
        setLastUpdated(new Date());
      }
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === 'AbortError') return;
      if (controllerRef.current === controller) {
        setError(requestError instanceof Error ? requestError.message : FAILED);
      }
    } finally {
      if (controllerRef.current === controller) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [projectId]);

  useEffect(() => {
    void load(false);
    return () => controllerRef.current?.abort();
  }, [load]);

  return { data, loading, refreshing, error, lastUpdated, refresh: () => load(true) };
}

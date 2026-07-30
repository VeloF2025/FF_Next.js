import { useCallback, useEffect, useRef, useState } from 'react';
import type { ZoneRegisterFilters, ZoneRegisterResult } from '../types/zoneDelivery.types';

interface ZoneRegisterResponse {
  success: boolean;
  data?: ZoneRegisterResult;
  error?: { message?: string };
}

export interface ZoneDeliveryRegisterState {
  data: ZoneRegisterResult | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
}

function registerUrl(filters: ZoneRegisterFilters): string {
  const query = new URLSearchParams();
  if (filters.projectId) query.set('project_id', filters.projectId);
  if (filters.zoneNo) query.set('zone_no', String(filters.zoneNo));
  if (filters.status) query.set('status', filters.status);
  if (filters.blocker) query.set('blocker', filters.blocker);
  if (filters.handover) query.set('handover', filters.handover);
  if (filters.search) query.set('search', filters.search);
  const search = query.toString();
  return `/api/zone-delivery/register${search ? `?${search}` : ''}`;
}

export function useZoneDeliveryRegister(filters: ZoneRegisterFilters): ZoneDeliveryRegisterState {
  const [data, setData] = useState<ZoneRegisterResult | null>(null);
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
    else setLoading(true);

    try {
      const response = await fetch(registerUrl(filters), {
        credentials: 'include',
        signal: controller.signal,
      });
      const payload = await response.json() as ZoneRegisterResponse;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error?.message || 'Unable to load zone delivery register.');
      }
      if (controllerRef.current === controller) {
        setData(payload.data);
        setLastUpdated(new Date());
      }
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
      if (controllerRef.current === controller) {
        setError(requestError instanceof Error ? requestError.message : 'Unable to load zone delivery register.');
      }
    } finally {
      if (controllerRef.current === controller) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [filters]);

  useEffect(() => {
    void load(false);
    return () => controllerRef.current?.abort();
  }, [load]);

  return {
    data,
    loading,
    refreshing,
    error,
    lastUpdated,
    refresh: () => load(true),
  };
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { log } from '@/lib/logger';
import type { DeliveryTreeResult } from './types';

export interface DeliveryTreeFilters {
  /** Empty string means "all projects". */
  projectId: string;
  opticalSubmittedOnly: boolean;
}

interface DeliveryTreeResponse {
  success: boolean;
  data?: DeliveryTreeResult;
  error?: { message?: string };
}

export interface DeliveryTreeState {
  data: DeliveryTreeResult | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const FAILURE_MESSAGE = 'Unable to load the delivery tree.';

function treeUrl(filters: DeliveryTreeFilters): string {
  const query = new URLSearchParams();
  if (filters.projectId) query.set('projectId', filters.projectId);
  if (filters.opticalSubmittedOnly) query.set('opticalSubmittedOnly', '1');
  const search = query.toString();
  return `/api/construction-qa/delivery-tree${search ? `?${search}` : ''}`;
}

/** Loads the Project → Zone → PON delivery tree for the current filters. */
export function useDeliveryTree(filters: DeliveryTreeFilters): DeliveryTreeState {
  const { projectId, opticalSubmittedOnly } = filters;
  const [data, setData] = useState<DeliveryTreeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setLoading(true);

    try {
      const response = await fetch(treeUrl({ projectId, opticalSubmittedOnly }), {
        credentials: 'include',
        signal: controller.signal,
      });
      const payload = await response.json() as DeliveryTreeResponse;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error?.message || FAILURE_MESSAGE);
      }
      if (controllerRef.current === controller) setData(payload.data);
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === 'AbortError') return;
      const message = requestError instanceof Error ? requestError.message : FAILURE_MESSAGE;
      log.error('Failed to load the delivery tree', {
        module: 'construction-qa',
        projectId,
        opticalSubmittedOnly,
        error: message,
      });
      if (controllerRef.current === controller) setError(message);
    } finally {
      if (controllerRef.current === controller) setLoading(false);
    }
  }, [projectId, opticalSubmittedOnly]);

  useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  return { data, loading, error, refresh: load };
}

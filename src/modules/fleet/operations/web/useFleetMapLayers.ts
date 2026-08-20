import { useCallback, useEffect, useRef, useState } from 'react';
import type { OperationalMapOverlay } from '../mapOverlayService';
import { parseOperationFilters, serializeOperationFilters, type OperationFilters } from './operationFilters';
import {
  isOperationsRequestAbort,
  OperationsPresentationApiError,
  operationsPresentationApi,
  type LiveFleetTelemetry,
} from './operationsPresentationApi';
import { currentOperationFilters, isCurrentOperationDate } from './useOperationalOverview';

const POLL_INTERVAL_MS = 30_000;
const ALWAYS_POLL = (): boolean => true;

export interface FleetMapLayerState<T> {
  data: T | null;
  lastSuccessAt: string | null;
  error: OperationsPresentationApiError | null;
  refresh: () => Promise<void>;
}

type FleetMapLayerInternalState<T> = Omit<FleetMapLayerState<T>, 'refresh'> & { selectionKey: string };

function emptyLayerState<T>(selectionKey: string): FleetMapLayerInternalState<T> {
  return { selectionKey, data: null, lastSuccessAt: null, error: null };
}

function usePollingLayer<T>(
  load: (signal: AbortSignal) => Promise<T>, shouldPoll: () => boolean, selectionKey: string,
  clearOnPermission = false,
): FleetMapLayerState<T> {
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [state, setState] = useState<FleetMapLayerInternalState<T>>(() => emptyLayerState(selectionKey));
  const refresh = useCallback(async (): Promise<void> => {
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    const requestGeneration = ++generation.current;
    try {
      const data = await load(requestController.signal);
      if (requestController.signal.aborted || generation.current !== requestGeneration) return;
      setState({ selectionKey, data, lastSuccessAt: new Date().toISOString(), error: null });
    } catch (error) {
      if (isOperationsRequestAbort(error) || requestController.signal.aborted
        || generation.current !== requestGeneration) return;
      const typed = error instanceof OperationsPresentationApiError ? error
        : new OperationsPresentationApiError('Fleet map layer request failed', 0, 'UNKNOWN_ERROR');
      setState((previous) => clearOnPermission && typed.kind === 'permission'
        ? { ...emptyLayerState<T>(selectionKey), error: typed }
        : previous.selectionKey === selectionKey
          ? { ...previous, error: typed } : { ...emptyLayerState<T>(selectionKey), error: typed });
    }
  }, [clearOnPermission, load, selectionKey]);

  useEffect(() => {
    void refresh();
    let timer: number | undefined;
    if (shouldPoll()) {
      timer = window.setInterval(() => {
        if (!shouldPoll()) {
          if (timer !== undefined) window.clearInterval(timer);
          timer = undefined;
          return;
        }
        void refresh();
      }, POLL_INTERVAL_MS);
    }
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      controller.current?.abort();
    };
  }, [refresh, shouldPoll]);
  const visible = state.selectionKey === selectionKey ? state : emptyLayerState<T>(selectionKey);
  return { data: visible.data, lastSuccessAt: visible.lastSuccessAt, error: visible.error, refresh };
}

export interface FleetMapLayersState {
  telemetry: FleetMapLayerState<LiveFleetTelemetry>;
  overlay: FleetMapLayerState<OperationalMapOverlay>;
}

export function useFleetMapLayers(filters: OperationFilters): FleetMapLayersState {
  const filterKey = serializeOperationFilters({
    projectId: filters.projectId, staffId: filters.staffId, siteId: filters.siteId,
    workDate: filters.workDate, asOf: filters.asOf,
  });
  const loadTelemetry = useCallback((signal: AbortSignal) => operationsPresentationApi.telemetry(signal), []);
  const loadOverlay = useCallback((signal: AbortSignal) => {
    const parsed = currentOperationFilters(parseOperationFilters(filterKey));
    return operationsPresentationApi.overlay(parsed, signal);
  }, [filterKey]);
  const shouldPollOverlay = useCallback(
    () => isCurrentOperationDate(parseOperationFilters(filterKey).workDate), [filterKey],
  );
  return {
    telemetry: usePollingLayer(loadTelemetry, ALWAYS_POLL, 'live-telemetry'),
    overlay: usePollingLayer(loadOverlay, shouldPollOverlay, filterKey, true),
  };
}

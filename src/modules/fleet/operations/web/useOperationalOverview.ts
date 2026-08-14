import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isOperationsRequestAbort,
  OperationsPresentationApiError,
  operationsPresentationApi,
  type OperationalOverviewResponse,
} from './operationsPresentationApi';
import { parseOperationFilters, serializeOperationFilters, type OperationFilters } from './operationFilters';

const POLL_INTERVAL_MS = 30_000;

function workDateAt(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function isCurrentOperationDate(workDate: string | undefined, now = new Date()): boolean {
  return workDate === workDateAt(now);
}

export function currentOperationFilters(filters: OperationFilters, now = new Date()): OperationFilters {
  return isCurrentOperationDate(filters.workDate, now) ? { ...filters, asOf: now.toISOString() } : filters;
}

export interface OperationalOverviewState {
  data: OperationalOverviewResponse | null;
  lastSuccessAt: string | null;
  error: OperationsPresentationApiError | null;
  refresh: () => Promise<void>;
}

export function useOperationalOverview(filters: OperationFilters): OperationalOverviewState {
  const filterKey = serializeOperationFilters(filters);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [state, setState] = useState<Omit<OperationalOverviewState, 'refresh'>>({
    data: null, lastSuccessAt: null, error: null,
  });

  const refresh = useCallback(async (): Promise<void> => {
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    const requestGeneration = ++generation.current;
    try {
      const parsed = parseOperationFilters(filterKey);
      const data = await operationsPresentationApi.overview(
        currentOperationFilters(parsed), requestController.signal,
      );
      if (requestController.signal.aborted || generation.current !== requestGeneration) return;
      setState((previous) => ({ ...previous, data, lastSuccessAt: new Date().toISOString(), error: null }));
    } catch (error) {
      if (isOperationsRequestAbort(error) || requestController.signal.aborted
        || generation.current !== requestGeneration) return;
      const typed = error instanceof OperationsPresentationApiError ? error
        : new OperationsPresentationApiError('Operational overview request failed', 0, 'UNKNOWN_ERROR');
      setState((previous) => ({ ...previous, error: typed }));
    }
  }, [filterKey]);

  useEffect(() => {
    void refresh();
    const timer = isCurrentOperationDate(parseOperationFilters(filterKey).workDate)
      ? window.setInterval(() => { void refresh(); }, POLL_INTERVAL_MS) : undefined;
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      controller.current?.abort();
    };
  }, [filterKey, refresh]);

  return { ...state, refresh };
}

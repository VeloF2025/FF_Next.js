/**
 * useStockExceptions Hook
 * Fetches held-serial exceptions (custody cross-checked vs OES/WA activations)
 * from GET /api/procurement/field-stock/accountability/exceptions.
 *
 * By default returns the three exception classes; pass includeAll to also get
 * recent_no_evidence. Filters re-fetch when they change. Postgres numeric columns
 * arrive as JSON strings and are coerced.
 */

import { useState, useCallback, useEffect } from 'react';

export type ExceptionClass =
  | 'cross_dr_conflict'
  | 'installed_not_cleared'
  | 'aged_no_evidence'
  | 'recent_no_evidence';

export interface StockException {
  serial_id: string;
  serial_number: string;
  status: string;
  holder_id: string;
  holder_type: 'staff' | 'contractor' | 'external_person';
  holder_name: string;
  stock_item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  project_id: string | null;
  project_name: string | null;
  held_since: string | null;
  held_days: number;
  wa_drop: string | null;
  oes_drop: string | null;
  oes_status: string | null;
  oes_activation_date: string | null;
  exception_class: ExceptionClass;
}

/** Postgres numeric columns arrive as strings over JSON; coerce to real numbers. */
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function toStockException(r: Record<string, unknown>): StockException {
  return {
    serial_id: String(r.serial_id),
    serial_number: String(r.serial_number),
    status: String(r.status),
    holder_id: String(r.holder_id),
    holder_type: r.holder_type as StockException['holder_type'],
    holder_name: String(r.holder_name),
    stock_item_id: (r.stock_item_id as string) ?? null,
    item_code: (r.item_code as string) ?? null,
    item_name: (r.item_name as string) ?? null,
    project_id: (r.project_id as string) ?? null,
    project_name: (r.project_name as string) ?? null,
    held_since: (r.held_since as string) ?? null,
    held_days: num(r.held_days),
    wa_drop: (r.wa_drop as string) ?? null,
    oes_drop: (r.oes_drop as string) ?? null,
    oes_status: (r.oes_status as string) ?? null,
    oes_activation_date: (r.oes_activation_date as string) ?? null,
    exception_class: r.exception_class as ExceptionClass,
  };
}

interface UseStockExceptionsOptions {
  holderId?: string;
  projectId?: string;
  exceptionClass?: ExceptionClass;
  includeAll?: boolean;
  autoFetch?: boolean;
}

interface UseStockExceptionsReturn {
  exceptions: StockException[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useStockExceptions(
  options: UseStockExceptionsOptions = {}
): UseStockExceptionsReturn {
  const { holderId, projectId, exceptionClass, includeAll, autoFetch = true } = options;
  const [exceptions, setExceptions] = useState<StockException[]>([]);
  // Start loading when we're going to auto-fetch, so the list shows the spinner
  // rather than a one-frame "no exceptions" flash before the first fetch fires.
  const [loading, setLoading] = useState(autoFetch);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (holderId) params.set('holderId', holderId);
      if (projectId) params.set('projectId', projectId);
      if (exceptionClass) params.set('class', exceptionClass);
      if (includeAll) params.set('includeAll', 'true');

      const response = await fetch(
        `/api/procurement/field-stock/accountability/exceptions?${params}`
      );
      if (!response.ok) throw new Error('Failed to fetch stock exceptions');
      const result = await response.json();
      const rows = (result.data as Record<string, unknown>[]) || [];
      setExceptions(rows.map(toStockException));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [holderId, projectId, exceptionClass, includeAll]);

  // Auto-fetch on mount and whenever a filter changes (refetch identity tracks
  // the filter deps). StrictMode double-invokes this in dev; the GET is
  // idempotent so the extra dev-only request is harmless.
  useEffect(() => {
    if (autoFetch) refetch();
  }, [autoFetch, refetch]);

  return { exceptions, loading, error, refetch };
}

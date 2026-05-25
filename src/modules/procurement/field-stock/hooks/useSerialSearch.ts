/**
 * useSerialSearch — fetches paginated serial-register rows from the
 * /serials/search API whenever the supplied filters change. Shared by the
 * warehouse / project drill-down pages (Wave 2 PR-12 / PR-13).
 *
 * The legacy serials/index.tsx has its own inline copy of this fetch logic;
 * this hook is the extracted, reusable form for the drill-down pages and does
 * NOT touch that page.
 */
import { useEffect, useState } from 'react';
import { log } from '@/lib/logger';
import type { SerialSearchFilters } from '@/types/field-stock';
import type { SerialSearchRowView } from '@/components/field-stock/SerialResultsTable';

interface UseSerialSearchReturn {
  rows: SerialSearchRowView[];
  total: number;
  loading: boolean;
  error: string | null;
}

function filtersToQuery(f: SerialSearchFilters): Record<string, string> {
  const q: Record<string, string> = {};
  if (f.q) q.q = f.q;
  if (f.status && f.status.length > 0) q.status = f.status.join(',');
  if (f.category) q.category = f.category;
  if (f.warehouseId) q.warehouseId = f.warehouseId;
  if (f.projectId) q.projectId = f.projectId;
  if (f.dropNumber) q.dropNumber = f.dropNumber;
  return q;
}

export function useSerialSearch(filters: SerialSearchFilters): UseSerialSearchReturn {
  const [rows, setRows] = useState<SerialSearchRowView[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Serialise filters so the effect re-runs on value changes, not identity.
  const queryString = new URLSearchParams(filtersToQuery(filters)).toString();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/procurement/field-stock/serials/search?${queryString}`,
          { credentials: 'include' }
        );
        const env = (await res.json()) as
          | { success: true; data: { rows: SerialSearchRowView[]; total: number } }
          | { success: false; error?: { message?: string } };
        if (cancelled) return;
        if (!env.success) {
          setError(env.error?.message ?? 'Search failed');
          return;
        }
        setRows(env.data.rows);
        setTotal(env.data.total);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Network error';
        setError(message);
        log.error('serial search fetch failed', { error: err }, 'useSerialSearch');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryString]);

  return { rows, total, loading, error };
}

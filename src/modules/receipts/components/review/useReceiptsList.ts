/**
 * Fetch + paging state for the review queue's list — split out of
 * pages/staff/receipts.tsx to keep that file under the 300-line cap.
 * Owns: the page-1 fetch (re-run on filter/refresh changes) and
 * loadMore() (appends the next PAGE_SIZE rows). Selection/drawer/action
 * state stays in the page — this hook only knows about the list itself.
 */
import React from 'react';

import { log } from '@/lib/logger';
import { buildQueryString, coerceSummary, totalMatchingStatus } from './filters';
import { emptySummary, type Filters, type ReviewListItem, type SummaryShape } from './types';

// Matches the API's default page size (pages/api/staff/receipts.ts).
// Requesting it explicitly keeps this page's paging in lockstep with the
// server's own default even if that default ever changes.
const PAGE_SIZE = 200;

export function useReceiptsList(
  filters: Filters,
  refreshTick: number,
  onPage1Loaded: () => void
) {
  const [items, setItems] = React.useState<ReviewListItem[] | null>(null);
  const [summary, setSummary] = React.useState<SummaryShape | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Re-fetch (page 1 only) whenever filters or refreshTick change.
  React.useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setErrorMsg(null);
      try {
        const qs = buildQueryString(filters, { summary: '1', limit: String(PAGE_SIZE), offset: '0' });
        const res = await fetch(`/api/staff/receipts${qs}`, { credentials: 'include' });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.success) {
          setErrorMsg(
            res.status === 403
              ? 'You do not have permission to review receipts.'
              : json?.error?.message ?? `Server returned HTTP ${res.status}`
          );
          setItems([]);
          setSummary(emptySummary());
          return;
        }
        setItems(json.data.items as ReviewListItem[]);
        setSummary(coerceSummary(json.data.summary));
        onPage1Loaded();
      } catch (err) {
        if (!cancelled) {
          log.error('[receipts-review] list fetch failed', err instanceof Error ? { message: err.message } : { err });
          setErrorMsg(err instanceof Error ? err.message : 'Failed to load receipts');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, refreshTick]);

  const loadMore = async () => {
    // Guard against a page-1 refetch (filters/refreshTick changed) still
    // in flight: `items.length` would be the stale pre-change count, so
    // an offset computed from it could return rows for the WRONG filter
    // — a fetch racing the page-1 request rather than following it.
    if (!items || loading || loadingMore) return;
    setLoadingMore(true);
    setErrorMsg(null);
    try {
      const qs = buildQueryString(filters, { limit: String(PAGE_SIZE), offset: String(items.length) });
      const res = await fetch(`/api/staff/receipts${qs}`, { credentials: 'include' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErrorMsg(json?.error?.message ?? `Server returned HTTP ${res.status}`);
        return;
      }
      setItems((prev) => [...(prev ?? []), ...(json.data.items as ReviewListItem[])]);
    } catch (err) {
      log.error('[receipts-review] load more failed', err instanceof Error ? { message: err.message } : { err });
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load more receipts');
    } finally {
      setLoadingMore(false);
    }
  };

  const totalForFilters = summary ? totalMatchingStatus(summary, filters.status) : 0;

  return {
    items,
    summary,
    loading,
    loadingMore,
    errorMsg,
    setErrorMsg,
    loadMore,
    totalForFilters,
  };
}

import { useState } from 'react';
import useSWR from 'swr';
import { log } from '@/lib/logger';
import type { RecentSubmissionsResponse, RecentWindow } from '../types/works-qa.types';

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
}

const fetcher = async (url: string): Promise<RecentSubmissionsResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as ApiEnvelope<RecentSubmissionsResponse> | RecentSubmissionsResponse;
  if ('data' in body && body.data) return body.data;
  return body as RecentSubmissionsResponse;
};

/**
 * Recent Submissions feed for the Works QA overview.
 *
 * The `since_last` window auto-advances the per-user watermark server-side (with
 * a 30-min session debounce), so we disable focus revalidation to avoid the
 * cutoff creeping forward on every tab focus. "Mark caught up" forces the
 * watermark to now via POST /recent-seen, then revalidates.
 */
export function useRecentSubmissions(initialWindow: RecentWindow = 'since_last') {
  const [window, setWindow] = useState<RecentWindow>(initialWindow);

  const { data, error, isLoading, mutate } = useSWR<RecentSubmissionsResponse>(
    `/api/works-qa/recent?window=${window}`,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  );

  async function markCaughtUp() {
    try {
      await fetch('/api/works-qa/recent-seen', { method: 'POST' });
      await mutate();
    } catch (err) {
      log.error('works-qa: mark-caught-up failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { recent: data, error, isLoading, window, setWindow, markCaughtUp };
}
